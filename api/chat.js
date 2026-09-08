const path = require('path');
const fs = require('fs');
const kuromoji = require('kuromoji');

let fetchImpl = typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis) : null;
if (!fetchImpl) {
  try { const undici = require('undici'); fetchImpl = undici.fetch; } catch (_) {}
}

const dataPath = path.join(__dirname, 'data.json');
let knowledgeBase = {};
try { knowledgeBase = JSON.parse(fs.readFileSync(dataPath, 'utf8')).knowledgeBase || {}; }
catch (e) { console.error('Failed to load data.json:', e.message); }

const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
const WOLFRAM_ALPHA_APP_ID = process.env.WOLFRAM_ALPHA_APP_ID;
let tokenizer = null;
const initTokenizer = new Promise(resolve => {
  try {
    const dictPath = path.join(path.dirname(require.resolve('kuromoji')), '..', 'dict');
    kuromoji.builder({ dicPath: dictPath }).build((err, built) => {
      if (err) console.error('Kuromoji init:', err.message || err);
      else tokenizer = built;
      resolve();
    });
  } catch (e) { console.error('Kuromoji init:', e.message || e); resolve(); }
});

const contextMap = new Map();
const MAX_HISTORY = 80;
const TTL = 30 * 60 * 1000;
const now = () => Date.now();
function push(ctx, role, text) { ctx.history.push({ role, text, ts: now() }); if (ctx.history.length > MAX_HISTORY) ctx.history.shift(); ctx.updatedAt = now(); }
function choose(a) { return a[Math.floor(Math.random() * a.length)]; }

function intent(t) {
  if (!t) return 'unknown';
  if (/^(おはよう|こんにちは|こんばんは|やあ|もしもし|おっす)/.test(t)) return 'greeting';
  if (/ありがとう|助かった|感謝|どうも/.test(t)) return 'thanks';
  if (/天気|気温|降水|雨|晴れ|雪|台風|予報/.test(t)) return 'weather';
  if (/ジョーク|冗談|ギャグ|おもしろ|笑わせて|ネタ/.test(t)) return 'joke';
  if (/助言|アドバイス|どうすれば|どうしたら|相談/.test(t)) return 'advice';
  if (/作り方|レシピ|材料|献立|調理法|料理|ご飯|メニュー|食べ物/.test(t)) return 'recipe';
  if (/[+\-*/^=]/.test(t) || /計算|平方根|微分|積分|方程式|解/.test(t)) return 'math';
  if (/\?|\？|かな|かも|だろう|何|どう|とは|って何/.test(t)) return 'question';
  return 'unknown';
}
function keywords(tokens) {
  const out = []; let b = [];
  const flush = () => { if (b.length) out.push(b.join('')); b = []; };
  for (const t of tokens || []) {
    const p = t.pos, d = t.pos_detail_1, s = t.surface_form || '';
    const ok = (p === '名詞' && ['固有名詞','一般','サ変接続'].includes(d)) || p === '形容詞' || (p === '動詞' && t.conjugated_form === '基本形') || (p === '助詞' && ['の','は','と'].includes(s));
    ok ? b.push(s) : flush();
  }
  flush();
  return [...new Set(out.filter(x => x.length > 1))].sort((a,b) => b.length-a.length);
}

async function getJson(url, options) {
  if (!fetchImpl) return null;
  try { const r = await fetchImpl(url, options); return r.ok ? await r.json() : null; } catch (_) { return null; }
}
async function wiki(q) {
  const j = await getJson(`https://ja.wikipedia.org/w/api.php?action=opensearch&limit=5&format=json&origin=*&search=${encodeURIComponent(q)}`);
  for (const title of j?.[1] || []) {
    const s = await getJson(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (s?.extract) return { source:'wikipedia', title:s.title, text:s.extract.slice(0,600) + (s.extract.length > 600 ? '...' : '') };
  }
  return null;
}
async function ddg(q) {
  const j = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skipsdisambig=1`);
  return j?.AbstractText ? { source:'duckduckgo', title:j.Heading || q, text:j.AbstractText.slice(0,600) + (j.AbstractText.length > 600 ? '...' : '') } : null;
}
async function recipe(q) {
  if (!SPOONACULAR_API_KEY) return null;
  const j = await getJson(`https://api.spoonacular.com/recipes/complexSearch?apiKey=${encodeURIComponent(SPOONACULAR_API_KEY)}&query=${encodeURIComponent(q)}&number=1&addRecipeInformation=true`);
  const r = j?.results?.[0]; if (!r) return null;
  return { source:'spoonacular', title:r.title, text:`「${r.title}」のレシピです。\n材料: ${r.extendedIngredients?.map(i=>i.name).join('、') || '情報なし'}\n手順:\n${r.analyzedInstructions?.[0]?.steps?.map(s=>`${s.number}. ${s.step}`).join('\n') || '手順情報なし'}` };
}
async function math(q) {
  if (!WOLFRAM_ALPHA_APP_ID) return null;
  const j = await getJson(`https://api.wolframalpha.com/v2/result?i=${encodeURIComponent(q)}&appid=${encodeURIComponent(WOLFRAM_ALPHA_APP_ID)}&output=json&units=metric&includepodid=Result`);
  return j?.Result ? { source:'wolframalpha', text:j.Result } : null;
}
async function weather(place) {
  const n = await getJson(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`, {headers:{'User-Agent':'agd-vercel-chat/1.0'}});
  if (!n?.[0]) return null;
  const lat=parseFloat(n[0].lat), lon=parseFloat(n[0].lon);
  const m=await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`);
  const c=m?.current_weather; if (!c) return null;
  return {source:'open-meteo', text:`${n[0].display_name} の現在の天気: 気温 ${c.temperature}°C、風速 ${c.windspeed} m/s（weathercode=${c.weathercode}）`};
}
async function joke(){ const j=await getJson('https://official-joke-api.appspot.com/random_joke'); return j?.setup ? {source:'joke',text:`${j.setup} — ${j.punchline || ''}`} : null; }
async function advice(){ const j=await getJson('https://api.adviceslip.com/advice'); return j?.slip?.advice ? {source:'advice',text:j.slip.advice} : null; }

async function getBotResponse(userId, message) {
  await initTokenizer;
  let ctx=contextMap.get(userId);
  if (!ctx || now()-ctx.updatedAt > TTL) ctx={history:[],lastKeyword:null,lastEntities:[],updatedAt:now()};
  push(ctx,'user',message);
  const type=intent(message);
  let result=null;
  if(type==='greeting') result={text:choose(['こんにちは！今日どうする？','やあ！何か知りたい？']),meta:{mode:type}};
  else if(type==='thanks') result={text:choose(['どういたしまして！','いつでも聞いてね。']),meta:{mode:type}};
  else if(type==='joke') {const r=await joke(); if(r) result={text:r.text,meta:{source:r.source}};}
  else if(type==='advice') {const r=await advice(); if(r) result={text:r.text,meta:{source:r.source}};}
  let tokens=[]; if(tokenizer){try{tokens=tokenizer.tokenize(message);}catch(_) {}}
  const ks=keywords(tokens); const queries=[message,...ks].filter(Boolean);
  if(!result && type==='recipe'){const r=await recipe(ks[0]||message);if(r) result={text:r.text,meta:{source:r.source,title:r.title}};}
  if(!result && type==='math'){const r=await math(message);if(r) result={text:r.text,meta:{source:r.source}};}
  if(!result && type==='weather'){for(const q of queries){const r=await weather(q);if(r){result={text:r.text,meta:{source:r.source}};break;}}}
  if(!result){for(const q of queries){const r=await wiki(q);if(r){result={text:`お調べしました：「${r.title}」 — ${r.text}`,meta:{source:r.source,title:r.title}};break;} const d=await ddg(q);if(d){result={text:`「${d.title}」に関する情報が見つかりました：${d.text}`,meta:{source:d.source,title:d.title}};break;}}}
  if(!result) result={text:'ごめんなさい、うまく見つけられませんでした。質問の内容を変えてみてください。',meta:{mode:'search_fail',keywords:ks}};
  push(ctx,'bot',result.text); contextMap.set(userId,ctx); return result;
}

module.exports = async (req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(204).end();
  try {
    let body={};
    if(req.method==='POST') body=typeof req.body==='object'?(req.body||{}):(req.body?JSON.parse(req.body):{});
    const q=req.method==='POST' ? body : (req.query||{});
    const userId=String(q.userId||q.user?.id||'anon');
    const message=q.message==null ? (q.q==null?null:String(q.q)) : String(q.message);
    if(q.init===true || q.init==='true' || q.init==='1' || q.welcome==='1') return res.status(200).json({reply:'何か質問はありますか？',text:'何か質問はありますか？',meta:{welcome:true}});
    if(!message || !message.trim()) return res.status(400).json({reply:'',text:'',error:'message (or q) is required'});
    const result=await getBotResponse(userId,message);
    return res.status(200).json({reply:result.text,text:result.text,meta:result.meta||{},took_ms:0});
  } catch(err) {
    console.error('handler error',err?.stack||err);
    return res.status(500).json({reply:'',text:'',error:'Internal Server Error',detail:err?.message||String(err)});
  }
};
