import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDocumentExportRouter } from './document-export.js';
test('document export is authenticated, validates input and returns complete Markdown and Word', async t => {
 const app=express();app.use('/api/documents',createDocumentExportRouter({requireAuth:(req,res,next)=>req.get('Authorization')==='Bearer qa'?next():res.sendStatus(401)}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const url=`http://127.0.0.1:${server.address().port}/api/documents/export`;
 const body={title:'تقرير يومك',report:'# تقرير يومك\n\n## مهامك\n\n- مراجعة المحاضرة',lang:'ar',sources:[],format:'md'};const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer qa'},body:JSON.stringify(body)};
 assert.equal((await fetch(url,{...options,headers:{'Content-Type':'application/json'}})).status,401);
 const md=await fetch(url,options);assert.equal(md.status,200);assert.equal(await md.text(),body.report);assert.ok(md.headers.get('content-disposition').includes('.md'));
 const word=await fetch(url,{...options,body:JSON.stringify({...body,format:'docx'})});assert.equal(word.status,200);assert.equal(Buffer.from(await word.arrayBuffer()).subarray(0,2).toString(),'PK');
 assert.equal((await fetch(url,{...options,body:JSON.stringify({...body,report:''})})).status,400);
});
