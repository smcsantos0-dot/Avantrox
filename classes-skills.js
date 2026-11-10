"use strict";
// Catálogo compartilhável com o cliente do jogo. Efeitos são descrições,
// não lógica de dano: combate e validação de ações serão implementados no jogo.
const CLASSES = Object.freeze({
  Guerreiro: {role:"Combate corpo a corpo",base:{forca:4,vigor:3,agilidade:1,inteligencia:0,fe:0},skills:[
    {id:"golpe_pesado",name:"Golpe Pesado",type:"basic",level:1,description:"Ataque corpo a corpo poderoso."},
    {id:"guarda_firme",name:"Guarda Firme",type:"passive",level:5,cost:1,description:"Aprimora a resistência ao bloquear."},
    {id:"onda_de_aco",name:"Onda de Aço",type:"advanced",level:15,cost:2,description:"Golpe em área à frente do guerreiro."}]},
  Mago: {role:"Magia elemental",base:{forca:0,vigor:1,agilidade:1,inteligencia:5,fe:1},skills:[
    {id:"orbe_arcano",name:"Orbe Arcano",type:"basic",level:1,description:"Projétil de energia arcana."},
    {id:"mente_ancestral",name:"Mente Ancestral",type:"passive",level:5,cost:1,description:"Melhora a eficiência da magia."},
    {id:"tempestade_astral",name:"Tempestade Astral",type:"advanced",level:15,cost:2,description:"Magia de área com energia cósmica."}]},
  Assassino: {role:"Agilidade e ataques precisos",base:{forca:2,vigor:1,agilidade:5,inteligencia:0,fe:0},skills:[
    {id:"corte_rapido",name:"Corte Rápido",type:"basic",level:1,description:"Ataque ágil de curta distância."},
    {id:"passos_sombrios",name:"Passos Sombrios",type:"passive",level:5,cost:1,description:"Melhora a mobilidade."},
    {id:"investida_fantasma",name:"Investida Fantasma",type:"advanced",level:15,cost:2,description:"Investida rápida contra um alvo."}]},
  Arqueiro: {role:"Ataques à distância com flechas consumíveis",base:{forca:1,vigor:1,agilidade:5,inteligencia:1,fe:0},skills:[
    {id:"tiro_preciso",name:"Tiro Preciso",type:"basic",level:1,description:"Disparo direcionado; consome uma flecha equipada."},
    {id:"olho_do_cacador",name:"Olho do Caçador",type:"passive",level:5,cost:1,description:"Aprimora a precisão dos disparos."},
    {id:"chuva_de_flechas",name:"Chuva de Flechas",type:"advanced",level:15,cost:2,description:"Dispara várias flechas; cada projétil consome uma unidade."}]},
  Invocador: {role:"Aliados e criaturas invocadas",base:{forca:0,vigor:1,agilidade:1,inteligencia:4,fe:2},skills:[
    {id:"chamado_espiritual",name:"Chamado Espiritual",type:"basic",level:1,description:"Invoca um aliado espiritual temporário."},
    {id:"elo_de_almas",name:"Elo de Almas",type:"passive",level:5,cost:1,description:"Fortalece criaturas invocadas."},
    {id:"legiao_eterea",name:"Legião Etérea",type:"advanced",level:15,cost:2,description:"Invoca múltiplos aliados temporários."}]},
  Paladino: {role:"Proteção e energia sagrada",base:{forca:2,vigor:3,agilidade:0,inteligencia:0,fe:3},skills:[
    {id:"golpe_radiante",name:"Golpe Radiante",type:"basic",level:1,description:"Ataque com energia sagrada."},
    {id:"voto_protetor",name:"Voto Protetor",type:"passive",level:5,cost:1,description:"Melhora a capacidade defensiva."},
    {id:"santuario",name:"Santuário",type:"advanced",level:15,cost:2,description:"Cria uma área de proteção temporária."}]},
  Ceifador: {role:"Energia das almas; classe secreta",secret:true,base:{forca:2,vigor:1,agilidade:3,inteligencia:2,fe:0},skills:[
    {id:"corte_de_almas",name:"Corte de Almas",type:"basic",level:100,description:"Ataque imbuído de energia espiritual."},
    {id:"eco_do_vazio",name:"Eco do Vazio",type:"passive",level:105,cost:1,description:"Amplifica a afinidade com o vazio."},
    {id:"eclipse_final",name:"Eclipse Final",type:"advanced",level:120,cost:2,description:"Golpe especial de energia sombria."}]}
});
const SKILL_INDEX = new Map(Object.entries(CLASSES).flatMap(([className,c])=>c.skills.map(s=>[s.id,{...s,className}])));
function pointsEarned(level){return Math.max(0,Math.floor(level)-1)} // 1 ponto por nível a partir do nível 2
function skillStatus(playerClass,level,unlocked){
 const selected=CLASSES[playerClass]; if(!selected)return null;
 const spent=unlocked.reduce((sum,id)=>sum+(SKILL_INDEX.get(id)?.className===playerClass?(SKILL_INDEX.get(id).cost||0):0),0);
 return {className:playerClass,role:selected.role,baseStats:selected.base,level,pointsEarned:pointsEarned(level),pointsSpent:spent,pointsAvailable:Math.max(0,pointsEarned(level)-spent),skills:selected.skills.map(s=>({...s,cost:s.cost||0,unlocked:s.type==='basic'&&level>=s.level||unlocked.includes(s.id),available:level>=s.level}))};
}
module.exports={CLASSES,SKILL_INDEX,pointsEarned,skillStatus};
