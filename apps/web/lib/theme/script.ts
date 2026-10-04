import { NYSE_EARLY_CLOSES, NYSE_HOLIDAYS } from "@unison/sdk/calendar";
import { PALETTE_KEY, THEME_COLOR, THEME_KEY } from "./theme.ts";

/**
 * Runs in <head> before first paint, so the page never flashes the wrong light. It mirrors `resolveTheme`
 * (lib/theme/theme.ts) and the SDK's `usEquitySession`; test/theme.test.ts executes this exact string against
 * both across a year of instants. Static content: its hash goes in the marketing CSP.
 */
export function themeBootScript(): string {
  const holidays = JSON.stringify([...NYSE_HOLIDAYS]);
  const early = JSON.stringify([...NYSE_EARLY_CLOSES]);
  return `(function(){var d=document.documentElement,m="market",p=null;
try{m=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"market";p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)})}catch(e){}
function s(t){var f=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"}).formatToParts(t),o={},i;for(i=0;i<f.length;i++)o[f[i].type]=f[i].value;
var day=o.year+"-"+o.month+"-"+o.day,n=Number(o.hour)*60+Number(o.minute),H=${holidays},E=${early};
if(o.weekday==="Sat"||o.weekday==="Sun"||H.indexOf(day)>=0)return 2;var x=E.indexOf(day)>=0,a=570,c=x?780:960,q=x?1020:1200;
if(n>=a&&n<c)return 0;if((n>=240&&n<a)||(n>=c&&n<q))return 1;return 2}
var t;try{t=m==="light"?"day":m==="dark"?"night":m==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"night":"day"):(s(new Date())===2?"night":"day")}catch(e){t="day"}
d.setAttribute("data-theme",t);d.setAttribute("data-theme-mode",m);if(p==="cvd")d.setAttribute("data-palette","cvd");
var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",t==="night"?${JSON.stringify(THEME_COLOR.night)}:${JSON.stringify(THEME_COLOR.day)});})();`;
}
