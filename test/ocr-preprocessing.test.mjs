import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { removeMenuRules } from '../scripts/update-menu-cache.mjs';

test('removes thin coloured rules while preserving dark letters and coloured food labels', async () => {
  const width = 200, height = 200;
  const data = Buffer.alloc(width * height * 3, 255);
  function pixel(x,y,r,g,b) { const i=(y*width+x)*3; data[i]=r; data[i+1]=g; data[i+2]=b; }
  for(let y=40;y<200;y++) pixel(2,y,220,0,90);
  for(let x=0;x<200;x++) pixel(x,45,220,0,90);
  for(let x=0;x<200;x+=2) pixel(x,120,220,0,90);
  // A letter touching the rule must survive; colour text must also survive.
  pixel(2,70,20,20,20);
  for(let y=80;y<90;y++) for(let x=10;x<160;x++) pixel(x,y,240,100,30);
  const image=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  const result=await sharp(await removeMenuRules(image)).raw().toBuffer();
  const at=(x,y)=>Array.from(result.subarray((y*width+x)*3,(y*width+x)*3+3));
  assert.deepEqual(at(2,65),[255,255,255]);
  assert.deepEqual(at(50,45),[255,255,255]);
  assert.deepEqual(at(60,120),[255,255,255]);
  assert.deepEqual(at(2,70),[20,20,20]);
  assert.deepEqual(at(50,85),[240,100,30]);
});

test('a neutral image remains pixel-identical', async () => {
  const image=await sharp({create:{width:200,height:200,channels:3,background:'#333333'}}).png().toBuffer();
  assert.deepEqual(await sharp(await removeMenuRules(image)).raw().toBuffer(), await sharp(image).raw().toBuffer());
});

test('warm lettering survives without changing headers or black type', async () => {
  const {preserveWarmText} = await import('../scripts/update-menu-cache.mjs');
  const width=200,height=200,data=Buffer.alloc(width*height*3,255);
  const set=(x,y,c)=>data.set(c,(y*width+x)*3);
  set(20,100,[240,150,60]); set(20,10,[240,150,60]);set(180,100,[240,150,60]);set(30,100,[20,20,20]);
  const image=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  const out=await sharp(await preserveWarmText(image)).raw().toBuffer();
  const at=(x,y)=>Array.from(out.subarray((y*width+x)*3,(y*width+x)*3+3));
  assert.deepEqual(at(20,100),[60,60,60]);assert.deepEqual(at(20,10),[240,150,60]);assert.deepEqual(at(180,100),[60,60,60]);assert.deepEqual(at(30,100),[20,20,20]);
});

test('an inline short connector remains despite low OCR confidence near the logos', async () => {
  const {filterLineWords}=await import('../scripts/update-menu-cache.mjs');
  const row=(text,left,width,conf=96)=>({text,left,width,top:100,height:25,conf});
  assert.equal(filterLineWords([row('bio',600,50),row('et',668,20,0)],805).map(w=>w.text).join(' '),'bio et');
  assert.equal(filterLineWords([row('pa',496,15,8)],805).length,0);
});

test('low-confidence rows can use a confident aligned reading from the other threshold', async () => {
  const {recognizeDayText}=await import('../scripts/update-menu-cache.mjs');
  const image=await sharp({create:{width:200,height:200,channels:3,background:'white'}}).png().toBuffer();
  const tsv=(text,conf)=>'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+`5\t1\t1\t1\t1\t1\t10\t100\t60\t25\t${conf}\t${text}`;
  const results=[{text:'En off e po',tsv:tsv('En off e po',15)},{text:'Kaki IGP',tsv:tsv('Kaki IGP',93)}];
  const worker={recognize:async()=>({data:results.shift()})};
  assert.match(await recognizeDayText(worker,[image,image],'Lundi'),/Kaki IGP/);
});

test('colour rescue adds a missing fruit row and cannot replace unrelated menu text', async () => {
  const {recognizeDayText}=await import('../scripts/update-menu-cache.mjs');
  const image=await sharp({create:{width:200,height:200,channels:3,background:'white'}}).png().toBuffer();
  const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
  const row=(line,top,text)=>`5\t1\t1\t1\t${line}\t1\t10\t${top}\t60\t25\t96\t${text}`;
  const normal={text:'Pain bio',tsv:header+row(1,100,'Pain bio')};
  const warm={text:'Pain bic\nKaki IGP',tsv:header+row(1,100,'Pain bic')+'\n'+row(2,150,'Kaki IGP')};
  const results=[normal,normal,warm];
  const worker={recognize:async()=>({data:results.shift()})};
  assert.equal(await recognizeDayText(worker,[image,image,{buffer:image,warmRows:[155]}],'Lundi'),'Lundi\nPain bio\nKaki IGP');
});

test('a standalone OCR letter cannot be appended as a menu item', async () => {
  const {recognizeDayText}=await import('../scripts/update-menu-cache.mjs');
  const image=await sharp({create:{width:200,height:200,channels:3,background:'white'}}).png().toBuffer();
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t100\t60\t25\t96\tPain bio\n5\t1\t1\t1\t2\t1\t10\t150\t15\t25\t96\tw';
  const worker={recognize:async()=>({data:{text:'Pain bio\nw',tsv}})};
  assert.equal(await recognizeDayText(worker,[image],'Lundi'),'Lundi\nPain bio');
});
