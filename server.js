import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Game} from './game.js';
import {addBot,decide,updateMoods} from './bots.js';
const rooms=new Map();
const broadcast=r=>{for(const [res,id] of r.clients)res.write(`data: ${JSON.stringify(r.game.view(id))}\n\n`);};
export const BOT_THINK_MS = 2000;
export const ACTION_HOLD_MS = 1000;

// One scheduled callback per room. The injected clock keeps timing tests fast.
export function createPacer(room, {
  publish = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, chooseAction = decide,
  onError = error => console.error('Poker turn scheduling failed:', error.message),
} = {}) {
  let timer = null;
  let stopped = false;
  const schedule = () => {
    if (stopped || timer !== null) return;
    const game = room.game;
    if (game.phase === 'finished') {
      if (!room.scored) {updateMoods(game);room.scored=true;}
      return;
    }
    const holding = game.pendingAdvance !== null;
    const seat = holding ? game.pendingAdvance : game.turn;
    const player = game.players[seat];
    if (!holding && !player?.bot) return;
    const handId = game.handId;
    timer = setTimer(() => {
      timer = null;
      if (stopped || game.handId !== handId) return;
      try {
        if (holding) {
          if (game.pendingAdvance !== seat) return;
          game.advance();
        } else {
          if (game.turn !== seat || game.pendingAdvance !== null) return;
          const action = chooseAction(game, seat);
          game.act(player.id, action.type, action.amount, {deferProgress:true});
        }
        schedule();
        publish();
      } catch (error) {
        // A bad decision or closed client must never crash the server or loop.
        onError(error);
      }
    }, holding ? ACTION_HOLD_MS : BOT_THINK_MS);
    timer?.unref?.();
  };
  return {
    schedule,
    stop() {stopped=true;if(timer!==null)clearTimer(timer);timer=null;},
  };
}

const ASSETS = {
  '/':['public/index.html','text/html'],
  '/app.js':['public/app.js','text/javascript'],
  '/style.css':['public/style.css','text/css'],
  '/bets.js':['public/bets.js','text/javascript'],
  '/poker.js':['poker.js','text/javascript'],
  '/equity.js':['equity.js','text/javascript'],
  '/equity-worker.js':['equity-worker.js','text/javascript'],
};
export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&ASSETS[url.pathname]){
      const [file,type]=ASSETS[url.pathname];res.setHeader('Content-Type',type);res.end(await readFile(new URL(`./${file}`,import.meta.url)));return;
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
      if(code){r=rooms.get(code);if(!r)throw Error('Raum nicht gefunden.');}else{if(rooms.size>=100)throw Error('Zu viele Räume.');do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));r={game:new Game(),clients:new Map(),created:Date.now()};r.pacer=createPacer(r,{publish:()=>broadcast(r)});rooms.set(code,r);}
      const token=randomBytes(24).toString('hex');r.game.add(token,name);result={room:code,token};broadcast(r);
    }else{const r=rooms.get(data.room);if(!r?.game.players.some(p=>p.id===data.token))throw Error('Sitzung nicht gefunden.');if(url.pathname==='/bot'){if(data.token!==r.game.players[0].id)throw Error('Nur der Gastgeber kann KI hinzufügen.');addBot(r.game,randomBytes(24).toString('hex'));}else if(url.pathname==='/start'){r.game.start(data.token);r.scored=false;}else r.game.act(data.token,data.type,data.amount,{deferProgress:true});r.pacer.schedule();broadcast(r);}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.on('close',()=>{for(const r of rooms.values())r.pacer.stop();rooms.clear();});
if(process.argv[1]===new URL(import.meta.url).pathname)server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Hobbypoker läuft auf Port '+(process.env.PORT||3000)));
