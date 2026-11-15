// GEDCOM parser, run in the browser so the viewer works as a static site (e.g. GitHub Pages).
function parseGedcom(text) {
  const people = {};
  const families = {};
  let rec = null;      // current level-0 record
  let ctx = [];        // tag stack by level
  let lastNote = null; // { obj, key } for CONC/CONT continuation

  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = Number(m[1]);
    const xref = m[2];
    const tag = m[3];
    const value = m[4] || "";
    ctx[level] = tag;
    ctx.length = level + 1;

    if (level === 0) {
      lastNote = null;
      if (tag === "INDI") {
        rec = { id: xref, name: "", sex: "U", birth: {}, death: {}, notes: [], famc: [], fams: [], refn: null };
        people[xref] = rec;
      } else if (tag === "FAM") {
        rec = { id: xref, husb: null, wife: null, chil: [] };
        families[xref] = rec;
      } else {
        rec = null;
      }
      continue;
    }
    if (!rec) continue;

    if (tag === "CONC" || tag === "CONT") {
      if (lastNote) lastNote.obj[lastNote.key] += (tag === "CONT" ? "\n" : "") + value;
      continue;
    }
    if (level === 1) lastNote = null;

    if (rec.husb !== undefined) {           // FAM record
      if (level === 1 && tag === "HUSB") rec.husb = value;
      else if (level === 1 && tag === "WIFE") rec.wife = value;
      else if (level === 1 && tag === "CHIL") rec.chil.push(value);
      continue;
    }
    // INDI record
    if (level === 1) {
      if (tag === "NAME") rec.name = value.replace(/\//g, "").replace(/\s+/g, " ").trim();
      else if (tag === "SEX") rec.sex = value;
      else if (tag === "FAMC") rec.famc.push(value);
      else if (tag === "FAMS") rec.fams.push(value);
      else if (tag === "REFN") rec.refn = value;
      else if (tag === "NOTE") { rec.notes.push(value); lastNote = { obj: rec.notes, key: rec.notes.length - 1 }; }
    } else if (level === 2 && (ctx[1] === "BIRT" || ctx[1] === "DEAT")) {
      const target = ctx[1] === "BIRT" ? rec.birth : rec.death;
      if (tag === "DATE") target.date = value;
      if (tag === "PLAC") target.place = value;
    }
  }

  // Pick a root: a person with no own family and the largest number of ancestors.
  const parentsOf = (id) => {
    const p = people[id];
    if (!p || !p.famc.length) return [];
    const f = families[p.famc[0]];
    return f ? [f.husb, f.wife].filter(Boolean) : [];
  };
  const countAncestors = (id) => {
    const seen = new Set();
    const stack = [id];
    while (stack.length) {
      for (const q of parentsOf(stack.pop())) if (!seen.has(q)) { seen.add(q); stack.push(q); }
    }
    return seen.size;
  };
  let root = null;
  let best = -1;
  for (const id of Object.keys(people)) {
    if (people[id].fams.length) continue;
    const n = countAncestors(id);
    if (n > best) { best = n; root = id; }
  }
  return { people, families, root };
}
