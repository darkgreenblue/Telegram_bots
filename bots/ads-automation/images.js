import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export async function prepareBanner(input,output){
  const bytes=await readFile(input);
  if(bytes.length>10_000_000)throw new Error('image file over 10 MB');
  const info=await sharp(bytes,{failOn:'error',limitInputPixels:20_000_000}).metadata();
  if(!['jpeg','png','webp'].includes(info.format)||!info.width||!info.height||info.width<640)throw new Error('unsupported image or too narrow');
  const ratio=info.width/info.height;
  if(ratio<1.5||ratio>2)throw new Error('banner aspect ratio too far from 16:9');
  const jpeg=await sharp(bytes,{failOn:'error',limitInputPixels:20_000_000})
    .rotate().resize(1280,720,{fit:'contain',background:'#ffffff',withoutEnlargement:false})
    .flatten({background:'#ffffff'}).jpeg({quality:88,mozjpeg:true}).toBuffer();
  if(jpeg.length>5_000_000)throw new Error('prepared banner exceeds Telegram Ads 5 MB');
  const dest=resolve(output);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,jpeg,{flag:'wx'});
  return {path:dest,sha256:createHash('sha256').update(jpeg).digest('hex'),width:1280,height:720,size:jpeg.length};
}

export async function saveTelegramImage(bot,fileId,output){
  const link=await bot.telegram.getFileLink(fileId);
  if(link.protocol!=='https:'||link.hostname!=='api.telegram.org')throw new Error('unexpected Telegram file host');
  const res=await fetch(link,{signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw new Error('Telegram image download failed');
  const declared=Number(res.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>10_000_000)throw new Error('image over 10 MB');
  const bytes=Buffer.from(await res.arrayBuffer());
  if(bytes.length>10_000_000)throw new Error('image over 10 MB');
  const dest=resolve(output);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx'});
  return dest;
}
