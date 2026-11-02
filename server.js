import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Game} from './game.js';
import {addBot,decide,updateMoods} from './bots.js';
const rooms=new Map();
const broadcast=r=>{for(const [res,id] of r.clients)res.write(`data: ${JSON.stringify(r.game.view(id))}\n\n`);};
function schedule(r){if(r.game.phase==='finished'){if(!r.scored){updateMoods(r.game);r.scored=true;}return;}if(r.timer||!r.game.players[r.game.turn]?.bot)return;r.timer=setTimeout(()=>{r.timer=null;const p=r.game.players[r.game.turn];if(!p?.bot)return;const action=decide(r.game,r.game.turn);r.game.act(p.id,action.type,action.amount);broadcast(r);schedule(r);},900);r.timer.unref();}
export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL(`./public/${file}`,import.meta.url)));return;
    }
    if(url.pathname==='/events'){
      const r=rooms.get(url.searchParams.get('room')),id=url.searchParams.get('token');if(!r?.game.players.some(p=>p.id===id))throw Error('Sitzung nicht gefunden.');
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});r.clients.set(res,id);res.write(`data: ${JSON.stringify(r.game.view(id))}\n\n`);const heartbeat=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clearInterval(heartbeat);r.clients.delete(res);});return;
    }
    if(req.method!=='POST'||!['/join','/start','/action','/bot'].includes(url.pathname)){res.writeHead(404);res.end();return;}
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw Error('Ungültiger Ursprung.');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Anfrage zu groß.');}const data=JSON.parse(body);
    let result={};
    if(url.pathname==='/join'){
      const name=String(data.name??'').trim().slice(0,24);if(!name)throw Error('Bitte gib deinen Namen ein.');
      let code=String(data.room??'').trim().toUpperCase(),r;
      if(code){r=rooms.get(code);if(!r)throw Error('Raum nicht gefunden.');}else{if(rooms.size>=100)throw Error('Zu viele Räume.');do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));r={game:new Game(),clients:new Map(),created:Date.now()};rooms.set(code,r);}
      const token=randomBytes(24).toString('hex');r.game.add(token,name);result={room:code,token};broadcast(r);
    }else{const r=rooms.get(data.room);if(!r?.game.players.some(p=>p.id===data.token))throw Error('Sitzung nicht gefunden.');if(url.pathname==='/bot'){if(data.token!==r.game.players[0].id)throw Error('Nur der Gastgeber kann KI hinzufügen.');addBot(r.game,randomBytes(24).toString('hex'));}else if(url.pathname==='/start'){r.game.start(data.token);r.scored=false;}else r.game.act(data.token,data.type,data.amount);schedule(r);broadcast(r);}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
if(process.argv[1]===new URL(import.meta.url).pathname)server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Hobbypoker läuft auf Port '+(process.env.PORT||3000)));
