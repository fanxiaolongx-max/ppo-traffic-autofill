import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeFeedbackAttachments, feedbackAttachmentPath, saveFeedbackAttachments } from '../src/feedback-attachments.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('validates and stores a feedback screenshot under a generated filename', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppo-feedback-file-'));
  try {
    const decoded=decodeFeedbackAttachments([{name:'screen.png',mime:'image/png',data:png.toString('base64')}]);
    const metadata=saveFeedbackAttachments(root,'fb_00000000-0000-4000-8000-000000000000',decoded);
    assert.equal(metadata[0].name,'screen.png');
    assert.equal(metadata[0].size,png.length);
    const file=feedbackAttachmentPath(root,'fb_00000000-0000-4000-8000-000000000000',metadata[0].storedName);
    assert.deepEqual(fs.readFileSync(file),png);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('rejects disguised, oversized, or excessive feedback attachments', () => {
  assert.throws(()=>decodeFeedbackAttachments([{name:'fake.png',mime:'image/png',data:Buffer.from('not png').toString('base64')}]),/不一致/);
  assert.throws(()=>decodeFeedbackAttachments(new Array(4).fill({name:'a.txt',mime:'text/plain',data:Buffer.from('ok').toString('base64')})),/最多只能上传/);
  assert.throws(()=>decodeFeedbackAttachments([{name:'a.txt',mime:'text/plain',data:Buffer.alloc(20,1).toString('base64')}],{maxFileBytes:10,maxTotalBytes:20}),/不能超过/);
});

test('refuses attachment path traversal', () => {
  assert.equal(feedbackAttachmentPath('/tmp/root','../../etc','passwd'),'');
  assert.equal(feedbackAttachmentPath('/tmp/root','fb_00000000-0000-4000-8000-000000000000','../secret.png'),'');
});
