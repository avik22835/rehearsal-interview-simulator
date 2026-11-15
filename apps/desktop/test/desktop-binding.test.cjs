const {test}=require('node:test');
const assert=require('node:assert/strict');
const {conversationUrl}=require('../desktop-gateway.cjs');
test('desktop bindings retain only canonical ChatGPT conversation URLs',()=>{
  assert.equal(conversationUrl('https://chatgpt.com/c/chat-123?ref=private'),'https://chatgpt.com/c/chat-123');
  for(const input of ['https://chatgpt.com/','https://chatgpt.com/c/','https://chatgpt.com.evil.test/c/chat','file:///c/chat','https://chatgpt.com/c/one/other','https://chatgpt.com/c/local-chatgpt:private'])assert.equal(conversationUrl(input),null);
});
