import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Matter from 'matter-js';
import { ArenaLane, MatchStatus, WorldEntity } from './types';

const LANES: ArenaLane[] = [0, 1, 2];
const HERO_ID = 'hero-body';
const RIVAL_ID = 'rival-body';

function laneToX(width: number, lane: ArenaLane): number {
  return width * (0.24 + lane * 0.26);
}

function makeEntity(body: Matter.Body, kind: WorldEntity['kind'], lane: ArenaLane, color: string): WorldEntity {
  const radius = kind === 'hero' || kind === 'rival' ? 34 : kind === 'orb' ? 12 : 16;
  return {
    id: String(body.label || body.id),
    kind,
    x: body.position.x,
    y: body.position.y,
    lane,
    radius,
    color,
  };
}

export function useGyanClashWorld(width: number, height: number, status: MatchStatus) {
  const engineRef = useRef(Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } }));
  const heroLaneRef = useRef<ArenaLane>(1);
  const spawnRef = useRef(0);
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [mana, setMana] = useState(0);
  const [dangerHits, setDangerHits] = useState(0);
  const arenaTop = Math.max(145, height * 0.22);
  const arenaBottom = Math.max(arenaTop + 260, height * 0.62);
  const laneXs = useMemo(() => LANES.map((lane) => laneToX(width, lane)), [width]);

  const resetWorld = useCallback(() => {
    const engine = engineRef.current;
    Matter.World.clear(engine.world, false);
    Matter.Engine.clear(engine);
    engine.gravity.x = 0;
    engine.gravity.y = 0;

    const hero = Matter.Bodies.circle(laneToX(width, 1), arenaBottom - 40, 34, {
      label: HERO_ID,
      isStatic: true,
      collisionFilter: { category: 0x0002 },
    });
    const rival = Matter.Bodies.circle(laneToX(width, 1), arenaTop + 32, 34, {
      label: RIVAL_ID,
      isStatic: true,
      collisionFilter: { category: 0x0004 },
    });
    Matter.World.add(engine.world, [hero, rival]);
    heroLaneRef.current = 1;
    spawnRef.current = 0;
    setMana(0);
    setDangerHits(0);
    setEntities([
      makeEntity(hero, 'hero', 1, '#F97316'),
      makeEntity(rival, 'rival', 1, '#22C55E'),
    ]);
  }, [arenaBottom, arenaTop, width]);

  useEffect(() => {
    resetWorld();
  }, [resetWorld]);

  const dashToLane = useCallback(
    (lane: ArenaLane) => {
      const engine = engineRef.current;
      const hero = engine.world.bodies.find((body) => body.label === HERO_ID);
      if (!hero) return;
      heroLaneRef.current = lane;
      Matter.Body.setPosition(hero, { x: laneToX(width, lane), y: arenaBottom - 40 });
    },
    [arenaBottom, width],
  );

  const spawnDrop = useCallback(() => {
    const lane = LANES[Math.floor(Math.random() * LANES.length)];
    const isOrb = Math.random() > 0.34;
    const body = Matter.Bodies.circle(laneToX(width, lane), arenaTop - 20, isOrb ? 12 : 16, {
      label: `${isOrb ? 'orb' : 'hazard'}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      isSensor: true,
    });
    Matter.Body.setVelocity(body, { x: 0, y: isOrb ? 2.4 : 3.1 });
    Matter.World.add(engineRef.current.world, body);
  }, [arenaTop, width]);

  useEffect(() => {
    if (status !== 'live') return;
    const interval = setInterval(() => {
      const engine = engineRef.current;
      spawnRef.current += 1;
      if (spawnRef.current % 20 === 0) spawnDrop();

      Matter.Engine.update(engine, 1000 / 30);
      const hero = engine.world.bodies.find((body) => body.label === HERO_ID);
      const remove: Matter.Body[] = [];
      const nextEntities: WorldEntity[] = [];

      for (const body of engine.world.bodies) {
        if (body.label === HERO_ID) {
          nextEntities.push(makeEntity(body, 'hero', heroLaneRef.current, '#F97316'));
          continue;
        }
        if (body.label === RIVAL_ID) {
          const rivalLane = LANES[Math.floor((spawnRef.current / 42) % LANES.length)];
          Matter.Body.setPosition(body, { x: laneToX(width, rivalLane), y: arenaTop + 32 });
          nextEntities.push(makeEntity(body, 'rival', rivalLane, '#22C55E'));
          continue;
        }

        const isOrb = body.label.startsWith('orb');
        const lane = LANES.reduce((best, lane) => {
          const currentDistance = Math.abs(laneToX(width, lane) - body.position.x);
          const bestDistance = Math.abs(laneToX(width, best) - body.position.x);
          return currentDistance < bestDistance ? lane : best;
        }, 0 as ArenaLane);

        if (body.position.y > arenaBottom + 40) {
          remove.push(body);
          continue;
        }

        if (hero && Math.hypot(hero.position.x - body.position.x, hero.position.y - body.position.y) < (isOrb ? 42 : 46)) {
          remove.push(body);
          if (isOrb) setMana((value) => Math.min(100, value + 9));
          else setDangerHits((value) => value + 1);
          continue;
        }

        nextEntities.push(makeEntity(body, isOrb ? 'orb' : 'hazard', lane, isOrb ? '#FACC15' : '#EF4444'));
      }

      if (remove.length) Matter.World.remove(engine.world, remove);
      setEntities(nextEntities);
    }, 33);
    return () => clearInterval(interval);
  }, [arenaBottom, arenaTop, spawnDrop, status, width]);

  return {
    entities,
    mana,
    dangerHits,
    laneXs,
    arenaTop,
    arenaBottom,
    activeLane: heroLaneRef.current,
    dashToLane,
  };
}
