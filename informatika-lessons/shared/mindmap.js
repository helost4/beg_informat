/* ============================================================
   ОТРИСОВКА ИНТЕЛЛЕКТ-КАРТЫ (SVG)
   Вызывается из app.js: renderMindMap(LESSON_DATA.mindmap, container)
   ============================================================ */
function renderMindMap(data, container){
  const NS = "http://www.w3.org/2000/svg";
  const W = 1100, H = 900;
  const cx = W/2, cy = H/2;

  const svg = document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  svg.setAttribute("width","100%");
  svg.setAttribute("height","100%");
  svg.style.maxWidth = W + "px";
  svg.style.height = "auto"; 
  svg.style.display = "block";
  svg.style.margin = "0 auto";

  const defs = document.createElementNS(NS,"defs");
  defs.innerHTML = `
    <linearGradient id="centerGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>`;
  svg.appendChild(defs);

  const groups = {};

  const N = data.branches.length;
  const R  = 210;
  const R2 = 350;

  data.branches.forEach((b,bi)=>{
    const angle = (-Math.PI/2) + (bi * 2*Math.PI/N);
    const bx = cx + R*Math.cos(angle);
    const by = cy + R*Math.sin(angle);

    const line = document.createElementNS(NS,"line");
    line.setAttribute("x1",cx); line.setAttribute("y1",cy);
    line.setAttribute("x2",bx); line.setAttribute("y2",by);
    line.setAttribute("stroke",b.color);
    line.setAttribute("stroke-width","3");
    svg.appendChild(line);

    const g = document.createElementNS(NS,"g");
    g.setAttribute("class","mm-node");
    g.style.cursor="pointer";
    const rx = 70, ry = 26;
    const rect = document.createElementNS(NS,"rect");
    rect.setAttribute("x",bx-rx); rect.setAttribute("y",by-ry);
    rect.setAttribute("width",rx*2); rect.setAttribute("height",ry*2);
    rect.setAttribute("rx","14");
    rect.setAttribute("fill",b.color);
    rect.setAttribute("filter","drop-shadow(0 4px 8px rgba(0,0,0,.15))");
    rect.style.animation = 'popIn .4s ease both';
    rect.style.animationDelay = (bi * 0.1) + 's';
    g.appendChild(rect);

    const txt = document.createElementNS(NS,"text");
    txt.setAttribute("x",bx); txt.setAttribute("y",by+5);
    txt.setAttribute("text-anchor","middle");
    txt.setAttribute("fill","#fff");
    txt.setAttribute("font-weight","700");
    txt.setAttribute("font-size","14");
    txt.textContent = b.text;
    g.appendChild(txt);
    svg.appendChild(g);

    const childGroup = document.createElementNS(NS,"g");
    childGroup.dataset.parent = bi;
    svg.appendChild(childGroup);
    groups[bi] = { group: childGroup, open: true, bx, by, branch:b };

    const spread = Math.min(Math.PI/2, 0.9);
    const M = b.children.length;
    b.children.forEach((c,ci)=>{
      const off = (M===1) ? 0 : (-spread/2 + spread*ci/(M-1));
      const cAng = angle + off;
      const cxp = cx + R2*Math.cos(cAng);
      const cyp = cy + R2*Math.sin(cAng);

      const cline = document.createElementNS(NS,"line");
      cline.setAttribute("x1",bx); cline.setAttribute("y1",by);
      cline.setAttribute("x2",cxp); cline.setAttribute("y2",cyp);
      cline.setAttribute("stroke",b.color);
      cline.setAttribute("stroke-width","2");
      cline.setAttribute("stroke-dasharray","5,4");
      cline.setAttribute("opacity","0.7");
      childGroup.appendChild(cline);

      const leaf = document.createElementNS(NS,"g");
      const lrx = 78, lry = 18;
      const lrect = document.createElementNS(NS,"rect");
      lrect.setAttribute("x",cxp-lrx); lrect.setAttribute("y",cyp-lry);
      lrect.setAttribute("width",lrx*2); lrect.setAttribute("height",lry*2);
      lrect.setAttribute("rx","10");
      lrect.setAttribute("fill","#fff");
      lrect.setAttribute("stroke",b.color);
      lrect.setAttribute("stroke-width","2");
      leaf.appendChild(lrect);

      const ltxt = document.createElementNS(NS,"text");
      ltxt.setAttribute("x",cxp); ltxt.setAttribute("y",cyp+4);
      ltxt.setAttribute("text-anchor","middle");
      ltxt.setAttribute("fill","#1e293b");
      ltxt.setAttribute("font-size","13");
      ltxt.textContent = c;
      leaf.appendChild(ltxt);
      childGroup.appendChild(leaf);
    });

    g.addEventListener('click',()=>{
      const st = groups[bi];
      st.open = !st.open;
      st.group.style.display = st.open ? '' : 'none';
    });
  });

  const cg = document.createElementNS(NS,"g");
  const crx = 90, cry = 40;
  const crect = document.createElementNS(NS,"rect");
  crect.setAttribute("x",cx-crx); crect.setAttribute("y",cy-cry);
  crect.setAttribute("width",crx*2); crect.setAttribute("height",cry*2);
  crect.setAttribute("rx","20");
  crect.setAttribute("fill","url(#centerGrad)");
  crect.setAttribute("filter","drop-shadow(0 6px 16px rgba(59,130,246,.45))");
  cg.appendChild(crect);

  const ctxt = document.createElementNS(NS,"text");
  ctxt.setAttribute("x",cx); ctxt.setAttribute("y",cy+8);
  ctxt.setAttribute("text-anchor","middle");
  ctxt.setAttribute("fill","#fff");
  ctxt.setAttribute("font-weight","800");
  ctxt.setAttribute("font-size","18");
  ctxt.textContent = data.center;
  cg.appendChild(ctxt);
  svg.appendChild(cg);

  container.innerHTML = "";
  container.appendChild(svg);
}