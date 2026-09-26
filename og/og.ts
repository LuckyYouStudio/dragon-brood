import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import { makeEggSprites } from '../src/art';
import { Dragon } from '../src/dragon';
import { SparkLayer } from '../src/fx';
import { NestView } from '../src/nest';

/** Seconds the Ancient has been out when the frame freezes: mid-roar, wings open. */
const FREEZE_AT = Number(new URLSearchParams(location.search).get('t') ?? 1.5);

const eggs = document.getElementById('eggs')!;
for (const sprite of makeEggSprites(152)) eggs.appendChild(sprite);

const nest = new NestView(document.getElementById('nest') as HTMLCanvasElement);
const sparks = new SparkLayer(document.getElementById('fx') as HTMLCanvasElement);
nest.setSize(5, false);
nest.setCharge(1);

let hatched = false;
let last = performance.now();
function frame(now: number): void {
  if (hatched) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  nest.update(dt);
  sparks.update(dt);
  nest.draw();
  sparks.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void document.fonts.ready.then(async () => {
  nest.startCracking();
  await nest.hatch(5, () => {
    sparks.setDragon(new Dragon(5, () => {}), () => nest.hatchEdge());
    hatched = true;
    // Fast-forward at a fixed step so the frozen frame does not depend on how often the
    // (possibly headless, virtual-time) browser paints.
    const step = 1 / 60;
    for (let t = 0; t < FREEZE_AT; t += step) {
      nest.update(step);
      sparks.update(step);
    }
    nest.draw();
    sparks.draw();
    document.title = 'ready';
  });
});
