import 'dotenv/config';
import express from 'express';
import { zipSync, strToU8 } from 'fflate';
import { createLecturesRouter } from '../lectures.js';
const app = express();
app.use('/lecture', createLecturesRouter({requireAuth:(req,res,next)=>{req.user={id:'synthetic-lecture-qa'};next();}}));
const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
try {
 let bytes=Buffer.from(zipSync({'ppt/slides/slide1.xml':strToU8('<a:t>Physics introduction. Energy is conserved in an isolated system. Kinetic energy equals one half mass times velocity squared. Example: mass 2 kg, velocity 3 m/s, kinetic energy 9 joules.</a:t>')}));
 let name='synthetic.pptx';
 if(process.argv[2]==='audio'){const fs=await import('node:fs/promises');bytes=await fs.readFile('data/lecture-qa/physics.wav');name='synthetic.wav';}
 if(process.argv[2]==='pdf'){const {default:puppeteer}=await import('puppeteer');const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<h1>Physics</h1><p>Energy is conserved in an isolated system. Kinetic energy = 0.5 * mass * velocity squared.</p>');bytes=Buffer.from(await page.pdf({format:'A4'}));name='synthetic.pdf';}finally{await browser.close();}}
 const response=await fetch(`http://127.0.0.1:${server.address().port}/lecture/analyze?language=ar`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Lecture-Name':name},body:bytes,signal:AbortSignal.timeout(240000)});
 const lines=(await response.text()).trim().split('\n').map(JSON.parse);const error=lines.find(x=>x.error);if(error)throw new Error(error.error);
 const result=lines.find(x=>x.result)?.result;if(!result?.summary||!result.explanation||!result.reviewNotes)throw new Error('Missing results');
 console.log('PASS '+name+' live synthetic lecture: Groq explanation + Gemini review; sections returned, '+result.sources.length+' source units. No personal files uploaded.');
} catch (error) { console.log('LIVE_NOT_CONFIRMED: '+error.message);process.exitCode=1; }finally{server.close();}



