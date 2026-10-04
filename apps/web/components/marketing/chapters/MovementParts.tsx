/**
 * The six parts of the Unison movement, drawn as the watch parts that do the same job: hairline technical
 * drawings on a 400-unit disc, so they can be exploded on one axis like a calibre in a maison's catalogue.
 */
const C = 200;
const R = 180;
const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [+(C + r * Math.cos(a)).toFixed(2), +(C + r * Math.sin(a)).toFixed(2)] as const;
};
const spiral = (r0: number, r1: number, turns: number, steps = 360) => {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = polar(r0 + (r1 - r0) * t, t * turns * 360);
    d += `${i ? "L" : "M"}${x},${y}`;
  }
  return d;
};

// drawn in the plate's colour: champagne at rest, ink when it is the part in focus
const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 1.1, vectorEffect: "non-scaling-stroke" as const };
const FINE = { ...LINE, strokeWidth: 0.6, opacity: 0.7 };

/** Gateway: the top plate, jewelled where orders come in: flat engraved jewels in hairline chatons. */
function Gateway() {
  return (
    <>
      <circle cx={C} cy={C} r={R} {...LINE} />
      <circle cx={C} cy={C} r={R - 34} {...FINE} />
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = polar(R - 17, i * 30);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={9.5} {...LINE} />
            <circle cx={x} cy={y} r={6.5} fill="var(--champagne)" />
          </g>
        );
      })}
    </>
  );
}

/** Book: a plate in Geneva stripes, rows of resting levels. */
function Book({ id }: { id: string }) {
  return (
    <>
      <defs>
        <clipPath id={id}>
          <circle cx={C} cy={C} r={R - 2} />
        </clipPath>
      </defs>
      <circle cx={C} cy={C} r={R} {...LINE} />
      <g clipPath={`url(#${id})`}>
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M${-40 + i * 34},400 Q${40 + i * 34},200 ${-40 + i * 34},0`} {...FINE} />
        ))}
      </g>
    </>
  );
}

/** Clearing: the escape wheel, releasing one batch per beat. */
function Clearing() {
  const teeth = 15;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    const a = (i * 360) / teeth;
    const [x0, y0] = polar(132, a);
    const [x1, y1] = polar(164, a + 6);
    const [x2, y2] = polar(150, a + 18);
    const [x3, y3] = polar(132, a + 24);
    d += `${i ? "L" : "M"}${x0},${y0} L${x1},${y1} L${x2},${y2} L${x3},${y3} `;
  }
  return (
    <>
      <path d={`${d}Z`} {...LINE} />
      <circle cx={C} cy={C} r={112} {...FINE} />
      {[0, 90, 180, 270].map((a) => {
        const [x, y] = polar(112, a);
        return <line key={a} x1={C} y1={C} x2={x} y2={y} {...LINE} />;
      })}
      <circle cx={C} cy={C} r={16} {...LINE} />
      <circle cx={C} cy={C} r={5} fill="var(--ball-3)" />
    </>
  );
}

/** References: the balance and its hairspring, the regulator everything is timed against. */
function References() {
  return (
    <>
      <circle cx={C} cy={C} r={154} {...LINE} />
      <circle cx={C} cy={C} r={144} {...FINE} />
      {[0, 120, 240].map((a) => {
        const [x, y] = polar(144, a);
        return <line key={a} x1={C} y1={C} x2={x} y2={y} {...LINE} />;
      })}
      {Array.from({ length: 8 }, (_, i) => {
        const [x, y] = polar(154, i * 45 + 22.5);
        return <circle key={i} cx={x} cy={y} r={4} {...LINE} />;
      })}
      <path d={spiral(14, 104, 9)} {...FINE} />
      <circle cx={C} cy={C} r={6} fill="var(--ball-3)" />
    </>
  );
}

/** Vault: the mainspring barrel, the power reserve. */
function Vault() {
  let teeth = "";
  for (let i = 0; i < 72; i++) {
    const [x0, y0] = polar(166, i * 5);
    const [x1, y1] = polar(176, i * 5 + 2.5);
    teeth += `${i ? "L" : "M"}${x0},${y0} L${x1},${y1} `;
  }
  return (
    <>
      <path d={`${teeth}Z`} {...LINE} />
      <circle cx={C} cy={C} r={158} {...FINE} />
      <path d={spiral(28, 146, 7)} {...LINE} />
      <circle cx={C} cy={C} r={24} {...LINE} />
    </>
  );
}

/** Compliance: the main plate in perlage, with blued screws, that holds the rest in place. */
function Compliance({ id }: { id: string }) {
  const grains: [number, number][] = [];
  for (let y = 30; y <= 370; y += 26) for (let x = 30 + ((y / 26) % 2) * 13; x <= 370; x += 26) grains.push([x, y]);
  return (
    <>
      <defs>
        <clipPath id={id}>
          <circle cx={C} cy={C} r={R - 2} />
        </clipPath>
      </defs>
      <circle cx={C} cy={C} r={R} {...LINE} />
      <g clipPath={`url(#${id})`}>
        {grains.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={11} {...FINE} />
        ))}
      </g>
      {[30, 150, 270].map((a) => {
        const [x, y] = polar(R - 30, a);
        return (
          <g key={a}>
            <circle cx={x} cy={y} r={10} fill="var(--ball-3)" />
            <line x1={x - 7} y1={y} x2={x + 7} y2={y} stroke="var(--bg-raised)" strokeWidth={2} transform={`rotate(${a} ${x} ${y})`} />
          </g>
        );
      })}
    </>
  );
}

export function MovementPart({ name }: { name: string }) {
  const id = `mv-${name.toLowerCase()}`;
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full overflow-visible" aria-hidden>
      {/* the plate itself: opaque enough to hide what lies under it, like brass */}
      <circle cx={C} cy={C} r={R} fill="var(--bg)" opacity={0.94} />
      {name === "Gateway" ? <Gateway /> : name === "Book" ? <Book id={id} /> : name === "Clearing" ? <Clearing /> : name === "References" ? <References /> : name === "Vault" ? <Vault /> : <Compliance id={id} />}
    </svg>
  );
}
