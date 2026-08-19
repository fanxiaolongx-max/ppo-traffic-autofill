#!/usr/bin/env bash
# ==============================================================================
# 修复 www.ppo.gov.eg 的 TLS 证书链缺失问题
#
# 【问题背景】
# 官网证书本身是正规的公共证书（由 DigiCert 的 Thawte TLS RSA CA G1 签发），
# 但服务器配置不全，握手时只下发叶子证书、不下发中间证书。浏览器缺了这一环
# 就无法把证书链接到系统内置的根 CA，于是报 ERR_CERT_AUTHORITY_INVALID，
# 导致官网的 CSS / JS（含 trafficservices.js）全部加载失败、查询功能异常。
#
# 【本脚本做什么】
# 1. 连接官网，检测服务器是否真的漏发了中间证书；
# 2. 从叶子证书的 AIA 扩展里解析出中间证书下载地址（不写死，官方换 CA 也能自适应）；
# 3. 下载中间证书，并用系统根证书库验证它确实能把官网证书链到受信任的公共根；
# 4. 验证通过后才导入钥匙串补链。
#
# 【安全说明】
# 导入的是中间证书，它由系统已经信任的公共根 CA 签发，因此不会新增任何信任锚点，
# 也不会扩大信任范围。这与旧版脚本「把网站证书当根证书信任」有本质区别 ——
# 后者相当于让一张网站证书获得签发任意域名的地位，本脚本会检测并协助清除它。
#
# 【用法】
#   ./trust_ppo_cert.sh            # 检测并修复（装到当前用户钥匙串，无需 sudo）
#   ./trust_ppo_cert.sh --check    # 只检测并报告，不做任何修改
#   ./trust_ppo_cert.sh --system   # 装到系统钥匙串（需要 sudo，全用户生效）
#   ./trust_ppo_cert.sh --revert   # 移除本脚本导入的中间证书
# ==============================================================================

set -euo pipefail

HOST="www.ppo.gov.eg"
PORT="443"
CA_BUNDLE="/etc/ssl/cert.pem"
STATE_FILE="${HOME}/.ppo_cert_chain_fix"
SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

MODE="fix"
USE_SYSTEM=0

for arg in "$@"; do
  case "$arg" in
    --check)  MODE="check" ;;
    --revert) MODE="revert" ;;
    --system) USE_SYSTEM=1 ;;
    -h|--help)
      sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "❌ 未知参数: $arg（可用: --check / --system / --revert / --help）"
      exit 1 ;;
  esac
done

for cmd in openssl curl security; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "❌ 缺少依赖命令: $cmd"; exit 1; }
done

WORK_DIR="$(mktemp -d /tmp/ppo_cert.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

CHAIN_RAW="${WORK_DIR}/chain.txt"
LEAF="${WORK_DIR}/leaf.pem"
INTER="${WORK_DIR}/intermediate.pem"

if [ "$USE_SYSTEM" -eq 1 ]; then
  TARGET_KEYCHAIN="$SYSTEM_KEYCHAIN"
  SUDO="sudo"
else
  TARGET_KEYCHAIN="$LOGIN_KEYCHAIN"
  SUDO=""
fi

# ------------------------------------------------------------------ 卸载模式
if [ "$MODE" = "revert" ]; then
  if [ ! -f "$STATE_FILE" ]; then
    echo "ℹ️  没有找到安装记录（${STATE_FILE}），本脚本未导入过任何证书。"
    exit 0
  fi
  # 记录格式: <SHA1指纹>|<证书CN>|<钥匙串路径>
  IFS='|' read -r SAVED_FPR SAVED_CN SAVED_KEYCHAIN < "$STATE_FILE"
  echo "🔎 安装记录: ${SAVED_CN}"
  echo "   指纹: ${SAVED_FPR}"
  echo "   钥匙串: ${SAVED_KEYCHAIN}"
  echo ""
  read -r -p "确认移除这张中间证书吗？(y/N) " ans
  if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
    echo "已取消。"
    exit 0
  fi
  RM_SUDO=""
  [ "$SAVED_KEYCHAIN" = "$SYSTEM_KEYCHAIN" ] && RM_SUDO="sudo"
  if $RM_SUDO security delete-certificate -Z "$SAVED_FPR" "$SAVED_KEYCHAIN" 2>/dev/null; then
    rm -f "$STATE_FILE"
    echo "✅ 已移除，并清除安装记录。"
  else
    echo "⚠️  移除失败（证书可能已被手动删除）。如需手动处理，请在「钥匙串访问」中搜索：${SAVED_CN}"
    exit 1
  fi
  exit 0
fi

# ------------------------------------------------- 1. 抓取服务器下发的证书链
echo "🔍 [1/5] 正在连接 ${HOST} 抓取证书链..."
if ! openssl s_client -showcerts -servername "$HOST" -connect "${HOST}:${PORT}" </dev/null >"$CHAIN_RAW" 2>/dev/null; then
  echo "❌ 无法连接 ${HOST}:${PORT}，请检查网络。"
  exit 1
fi

CERT_COUNT="$(grep -c 'BEGIN CERTIFICATE' "$CHAIN_RAW" || true)"
if [ "$CERT_COUNT" -eq 0 ]; then
  echo "❌ 未能取得任何证书，请检查网络或代理设置。"
  exit 1
fi

# 取链上第一张（叶子证书）
awk '/BEGIN CERTIFICATE/{n++} n==1{print} /END CERTIFICATE/{if(n==1) exit}' "$CHAIN_RAW" >"$LEAF"

LEAF_CN="$(openssl x509 -in "$LEAF" -noout -subject 2>/dev/null | sed 's/.*CN *= *//')"
LEAF_ISSUER="$(openssl x509 -in "$LEAF" -noout -issuer 2>/dev/null | sed 's/.*CN *= *//')"
LEAF_EXPIRY="$(openssl x509 -in "$LEAF" -noout -enddate 2>/dev/null | cut -d= -f2)"

echo "   证书主体 : ${LEAF_CN}"
echo "   签发机构 : ${LEAF_ISSUER}"
echo "   有效期至 : ${LEAF_EXPIRY}"
echo "   服务器下发证书数: ${CERT_COUNT}"

if ! openssl x509 -in "$LEAF" -noout -checkend 0 >/dev/null 2>&1; then
  echo ""
  echo "⛔ 官网证书已过期（${LEAF_EXPIRY}）。这是官方服务器的问题，补链也无法解决，"
  echo "   请等待官方更换证书，期间不要绕过浏览器的安全警告。"
  exit 1
fi

# --------------------------------------------- 2. 判断服务器是否漏发中间证书
echo ""
echo "🔍 [2/5] 正在校验证书链完整性..."

# 维度一：服务器自身下发的链是否完整（服务器配置问题，本机补链不会改变这个结果）
SERVER_CHAIN_OK=0
openssl verify -CAfile "$CA_BUNDLE" "$LEAF" >/dev/null 2>&1 && SERVER_CHAIN_OK=1

# 维度二：本机当前能否通过系统信任评估（这才是浏览器实际采信的结果，补链后会变 OK）
LOCAL_TRUST_OK=0
security verify-cert -c "$LEAF" -p ssl >/dev/null 2>&1 && LOCAL_TRUST_OK=1

if [ "$SERVER_CHAIN_OK" -eq 1 ]; then
  echo "✅ 服务器已下发完整证书链，无需修复。"
  echo "   若浏览器仍报证书错误，多半是本机代理 / 中间人软件（如某些杀毒、抓包工具）改写了证书。"
  exit 0
fi

echo "⚠️  服务器未下发中间证书（这是官方服务器的配置问题，本脚本无法改变）。"
if [ "$LOCAL_TRUST_OK" -eq 1 ]; then
  echo "✅ 但本机已补齐中间证书，系统信任评估通过 —— 浏览器可以正常访问，无需再次修复。"
  echo "   （即使官方之后更换叶子证书，只要签发机构不变就依然有效。）"
  if [ -f "$STATE_FILE" ]; then
    IFS='|' read -r _FPR _CN _KC <"$STATE_FILE"
    echo "   本机已导入: ${_CN}"
  fi
  exit 0
fi
echo "⛔ 本机系统信任评估未通过，这正是浏览器报 ERR_CERT_AUTHORITY_INVALID 的原因。"

# ------------------------------- 3. 从 AIA 扩展解析中间证书地址（不写死 URL）
echo ""
echo "🔍 [3/5] 正在从证书的 AIA 扩展解析中间证书下载地址..."
AIA_URL="$(openssl x509 -in "$LEAF" -noout -text 2>/dev/null \
  | sed -n 's/.*CA Issuers - URI:\(.*\)/\1/p' | head -1 | tr -d '[:space:]')"

if [ -z "$AIA_URL" ]; then
  echo "❌ 证书里没有 CA Issuers 地址，无法自动补链。"
  echo "   请改用浏览器导出完整证书链后手动导入。"
  exit 1
fi
echo "   下载地址: ${AIA_URL}"

if [ "$MODE" = "check" ]; then
  echo ""
  echo "📋 [检测模式] 诊断结论：服务器漏发中间证书，可通过导入 ${AIA_URL} 修复。"
  echo "   执行 ./trust_ppo_cert.sh 即可自动完成（本次未做任何修改）。"
  exit 0
fi

# ------------------------------------------------ 4. 下载并验证能否补全信任链
echo ""
echo "📥 [4/5] 正在下载中间证书并验证信任链..."
if ! curl -fsSL --max-time 30 -o "${WORK_DIR}/inter.bin" "$AIA_URL"; then
  echo "❌ 下载失败，请检查网络后重试。"
  exit 1
fi

# 证书可能是 DER 也可能是 PEM，两种都试
if openssl x509 -inform DER -in "${WORK_DIR}/inter.bin" -out "$INTER" 2>/dev/null; then
  :
elif openssl x509 -inform PEM -in "${WORK_DIR}/inter.bin" -out "$INTER" 2>/dev/null; then
  :
else
  echo "❌ 下载到的文件不是有效证书。"
  exit 1
fi

INTER_CN="$(openssl x509 -in "$INTER" -noout -subject 2>/dev/null | sed 's/.*CN *= *//')"
INTER_ISSUER="$(openssl x509 -in "$INTER" -noout -issuer 2>/dev/null | sed 's/.*CN *= *//')"
INTER_FPR="$(openssl x509 -in "$INTER" -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2)"

# 关键安全校验：确认「叶子 + 这张中间证书」能锚定到系统内置的公共根 CA。
# 校验不通过就绝不导入 —— 避免把来路不明的证书塞进钥匙串。
if ! openssl verify -CAfile "$CA_BUNDLE" -untrusted "$INTER" "$LEAF" >/dev/null 2>&1; then
  echo "❌ 安全校验未通过：这张中间证书无法把官网证书链接到系统内置的受信任根 CA。"
  echo "   已中止，不会导入任何证书。你的网络可能存在中间人劫持，请勿绕过浏览器警告。"
  exit 1
fi

echo "✅ 安全校验通过，该中间证书可锚定到系统内置的受信任根 CA。"
echo "   中间证书 : ${INTER_CN}"
echo "   其签发者 : ${INTER_ISSUER}（系统已内置信任）"
echo "   SHA-1    : ${INTER_FPR}"

# ------------------------------------------------------------- 5. 导入钥匙串
echo ""
echo "🔐 [5/5] 正在导入钥匙串: ${TARGET_KEYCHAIN}"
[ "$USE_SYSTEM" -eq 1 ] && echo "   （系统钥匙串需要管理员权限，请输入 Mac 开机密码）"

if $SUDO security add-certificates -k "$TARGET_KEYCHAIN" "$INTER" 2>/dev/null; then
  echo "${INTER_FPR}|${INTER_CN}|${TARGET_KEYCHAIN}" >"$STATE_FILE"
  echo "✅ 导入成功。"
else
  # 证书已存在时 add-certificates 会返回非零，视为幂等成功
  if security find-certificate -Z "$INTER_FPR" "$TARGET_KEYCHAIN" >/dev/null 2>&1; then
    echo "${INTER_FPR}|${INTER_CN}|${TARGET_KEYCHAIN}" >"$STATE_FILE"
    echo "✅ 该中间证书已在钥匙串中，无需重复导入。"
  else
    echo "❌ 导入失败。可改用系统钥匙串重试: ./trust_ppo_cert.sh --system"
    exit 1
  fi
fi

# -------------------------------------- 检测旧版脚本遗留的高风险信任设置
LEGACY="$(security find-certificate -c "*.ppo.gov.eg" "$SYSTEM_KEYCHAIN" 2>/dev/null || true)"
if [ -n "$LEGACY" ]; then
  echo ""
  echo "⚠️  检测到系统钥匙串里存在旧版脚本导入的网站证书 (*.ppo.gov.eg)。"
  echo "   旧版把它设成了「受信任的根证书」，等于让一张网站证书获得签发任意域名的地位，"
  echo "   存在安全风险，且证书一换就失效。现在补链已完成，它不再需要了。"
  echo ""
  read -r -p "是否现在移除它？(y/N) " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    if sudo security delete-certificate -c "*.ppo.gov.eg" "$SYSTEM_KEYCHAIN" 2>/dev/null; then
      echo "✅ 旧证书已移除。"
    else
      echo "⚠️  自动移除失败。请打开「钥匙串访问」→ 系统 → 搜索 ppo.gov.eg → 手动删除。"
    fi
  else
    echo "已跳过。稍后可随时手动清理。"
  fi
fi

echo ""
echo "🎉 修复完成！"
echo "👉 请完全退出 Chrome（Cmd+Q，不是关窗口）后重新打开官网。"
echo "   验证方式：F12 打开 Console，确认不再出现 ERR_CERT_AUTHORITY_INVALID。"
echo ""
echo "ℹ️  中间证书有效期通常长达数年，官方更换叶子证书后无需重跑本脚本。"
echo "   如需撤销本次修改：./trust_ppo_cert.sh --revert"
