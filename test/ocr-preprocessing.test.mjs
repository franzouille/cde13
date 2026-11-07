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
