import test from 'node:test';
import assert from 'node:assert/strict';
import { chatModelOrder, createModelChat } from './chat-models.js';
test('Qwen is opt-in per route, originals and operator disable remain respected',()=>{
 assert.deepEqual(chatModelOrder('groq',{},true),['qwen/qwen3.8-27b','openai/gpt-oss-120b','openai/gpt-oss-20b']);
 assert.deepEqual(chatModelOrder('cerebras',{CEREBRAS_MODEL:'existing'},false),['existing']);
 assert.deepEqual(chatModelOrder('cerebras',{QWEN_ENABLED:'false'},true),['gpt-oss-120b']);
});
test('Qwen fallback preserves messages and tool calls without executing anything',async()=>{
 const calls=[];const messages=[{role:'user',content:'اعرض يومي'}];const tools=[{type:'function',function:{name:'read_day',description:'Read only',parameters:{type:'object',properties:{}}}}];
 const chat=createModelChat({config:{GROQ_API_KEY:'private'},fetcher:async(url,options)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(options.body);calls.push(body);assert.equal(options.headers.Authorization,'Bearer private');return calls.length===1?new Response('',{status:503}):Response.json({model:body.model,choices:[{message:{content:null,tool_calls:[{id:'test',type:'function',function:{name:'read_day',arguments:'{}'}}]}}]});}});
 const result=await chat('groq','system',messages,tools,true);assert.equal(result.aqlRequestedModel,'openai/gpt-oss-120b');assert.deepEqual(calls[0].tools,tools);assert.deepEqual(calls[0].messages.slice(1),messages);assert.equal(result.choices[0].message.tool_calls[0].function.name,'read_day');
});
test('empty answers fall back and invalid keys do not loop',async()=>{
 let calls=0;const chat=createModelChat({config:{CEREBRAS_API_KEY:'private'},fetcher:async()=>{calls++;return calls===1?Response.json({choices:[{message:{content:''}}]}):Response.json({choices:[{message:{content:'جاهز'}}]});}});assert.equal((await chat('cerebras','s',[],null,true)).aqlRequestedModel,'gpt-oss-120b');
 calls=0;const denied=createModelChat({config:{GROQ_API_KEY:'private'},fetcher:async()=>{calls++;return new Response('',{status:401});}});await assert.rejects(denied('groq','s',[],null,true),/401/);assert.equal(calls,1);
});
