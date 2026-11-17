import 'dotenv/config';
import assert from 'node:assert/strict';
import { createModelChat } from '../chat-models.js';
import { planCalendarRequest } from '../calendar-planning.js';
const chat=createModelChat();
await Promise.all(['cerebras','groq'].map(async provider=>{
 try {
  const result=await chat(provider,'أجب بالعربية بجملة واحدة فقط ولا تدّع تنفيذ أي إجراء.',[{role:'user',content:'كيف تساعدني في تنظيم يومي؟'}],null,true);
  assert.ok(result.aqlRequestedModel.includes('qwen'));assert.match(result.choices[0].message.content,/[\u0600-\u06ff]/);
  const now=Date.parse('2026-11-18T10:00:00+03:00');
  const draft=await planCalendarRequest({message:'أضف موعد للنادي بعد ربع ساعة لمدة نصف ساعة',timeZone:'Asia/Riyadh',lang:'ar',now,generate:async(system,input)=>{const data=await chat(provider,system,[{role:'user',content:input}],null,true);assert.ok(data.aqlRequestedModel.includes('qwen'));return data.choices[0].message.content.replace(/^```json\s*/,'').replace(/\s*```$/,'');}});
  assert.equal(draft.kind,'event');assert.equal(Date.parse(draft.event.start)-now,15*60000);assert.equal(Date.parse(draft.event.end)-Date.parse(draft.event.start),30*60000);
  const tools=[{type:'function',function:{name:'read_calendar',description:'Read the calendar for a named period. Read-only.',parameters:{type:'object',properties:{period:{type:'string',enum:['today']}},required:['period']}}}];
  const tool=await chat(provider,'You must call read_calendar to answer a schedule question. Do not invent calendar data.',[{role:'user',content:'وش عندي اليوم؟'}],tools,true);
  assert.ok(tool.aqlRequestedModel.includes('qwen'));assert.equal(tool.choices[0].message.tool_calls[0].function.name,'read_calendar');assert.equal(JSON.parse(tool.choices[0].message.tool_calls[0].function.arguments).period,'today');
  console.log('PASS '+provider+' Qwen: Arabic reply, exact 15-minute offset/30-minute reviewed draft, read-only tool selection. No tools executed or events saved.');
 }catch(error){console.log('NOT_CONFIRMED '+provider+': '+error.message);process.exitCode=1;}
}));
