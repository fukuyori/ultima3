import { describe, it, expect } from 'vitest';
import { newWorld, FakeIO } from './helpers.ts';
import { Key } from '../src/game/io.ts';
import { cast } from '../src/game/spells.ts';
import { shop } from '../src/game/shops.ts';
import { runDungeon } from '../src/game/dungeon.ts';
import { DungeonCell, type World } from '../src/game/world.ts';
import { Location } from '../src/game/party.ts';
import { MapValue } from '../src/game/tiles.ts';
import { MapId } from '../src/data/resources.ts';
import { PlayerOffset } from '../src/game/player.ts';
import { mostHurt, poisoned, fallen, ashes, unmarked, bestCaster } from '../src/game/whom.ts';

// The default party: Tatiana the thief, Roderic the ranger, Norric the cleric and Ghiselle the wizard, 100 hit points
// each and no mana.
const CLERIC = 2;

function townWorld(): { world: World; io: FakeIO } {
  const world = newWorld(99);
  world.enterMap(MapId.FirstTown);
  world.party.location = Location.Town;
  world.current.tiles.fill(MapValue.Floor);
  world.monsters.bytes.fill(0);
  world.x = 20;
  world.y = 20;
  return { world, io: new FakeIO(world.resources) };
}

describe('where a "Who?" starts', () => {
  it('a heal on the most hurt living member, ties to the most hit points, then marching order', () => {
    const world = newWorld();
    expect(mostHurt(world)).toBeUndefined(); // nobody hurt: the first member, as ever
    world.member(1).hitPoints = 70;
    world.member(3).hitPoints = 40;
    expect(mostHurt(world)).toBe(3);
    world.member(3).status = 'D';
    expect(mostHurt(world)).toBe(1); // the dead are not healed
    world.member(0).bytes[PlayerOffset.MaxHitPointsLo] = 130; // 30 short, as Roderic is, with more hit points left
    expect(mostHurt(world)).toBe(0);
  });

  it('a cure on the poisoned, a resurrection on the dead, a recall on the ashes', () => {
    const world = newWorld();
    expect([poisoned(world), fallen(world), ashes(world)]).toEqual([undefined, undefined, undefined]);
    world.member(1).status = 'P';
    world.member(2).status = 'P';
    world.member(2).hitPoints = 120;
    world.member(3).status = 'D';
    world.member(0).status = 'A';
    expect([poisoned(world), fallen(world), ashes(world)]).toEqual([2, 3, 0]);
  });

  it("a rod's mark on a living member without it, the most hit points first", () => {
    const world = newWorld();
    expect(unmarked(world, 0x10)).toBe(0);
    world.member(0).bytes[14] |= 0x10;
    world.member(1).hitPoints = 60;
    expect(unmarked(world, 0x10)).toBe(2);
    expect(unmarked(world, 0x20)).toBe(0); // another mark: Tatiana has not got that one
    for (const m of [1, 2, 3]) world.member(m).bytes[14] |= 0x10;
    expect(unmarked(world, 0x10)).toBeUndefined();
  });

  it("never a rod's on a member its burn of 50 would kill", () => {
    const world = newWorld();
    world.member(0).hitPoints = 50; // the burn would kill her
    world.member(1).hitPoints = 51;
    world.member(2).hitPoints = 30;
    world.member(3).hitPoints = 40;
    expect(unmarked(world, 0x10)).toBe(1); // the only one who lives through it
    world.member(1).hitPoints = 50;
    expect(unmarked(world, 0x10)).toBeUndefined(); // nobody: the first member, as ever, the choice the player's
  });

  it('Cast on the living caster with the most mana', () => {
    const world = newWorld();
    expect(bestCaster(world)).toBe(1); // Roderic, the first caster: the thief has no magic
    world.member(3).mana = 30;
    expect(bestCaster(world)).toBe(3);
    world.member(3).status = 'D';
    expect(bestCaster(world)).toBe(1);
  });
});

describe('the prompts start there', () => {
  it('Cast by whom, in the field', async () => {
    const world = newWorld();
    const io = new FakeIO(world.resources);
    world.member(2).mana = 25;
    io.keys = [Key.Escape];
    await cast(world, io);
    expect(io.preferredMember).toBe(2);
  });

  it("each of a cleric's whom-spells", async () => {
    const asked = async (letter: string, setUp: (world: World) => void) => {
      const world = newWorld();
      const io = new FakeIO(world.resources);
      world.member(CLERIC).mana = 99;
      setUp(world);
      io.keys = [letter, Key.Escape];
      await cast(world, io, CLERIC);
      return io.preferredMember;
    };
    expect(await asked('C', (w) => (w.member(1).hitPoints = 50))).toBe(1); // Sanctu: heal
    expect(await asked('K', (w) => (w.member(3).hitPoints = 50))).toBe(3); // Sanctu Mani: great heal
    expect(await asked('H', (w) => (w.member(3).status = 'P'))).toBe(3); // Alcort: cure
    expect(await asked('N', (w) => (w.member(0).status = 'D'))).toBe(0); // Surmandum: resurrect
    expect(await asked('P', (w) => (w.member(1).status = 'A'))).toBe(1); // Anju Sermani: recall
  });

  it("each of the healer's services", async () => {
    const asked = async (service: string, setUp: (world: World) => void) => {
      const { world, io } = townWorld();
      world.party.gold = 1000;
      setUp(world);
      io.keys = [service, 'Y', Key.Escape];
      await shop(world, io, 2, 0);
      return io.preferredMember;
    };
    expect(await asked('1', (w) => (w.member(3).status = 'P'))).toBe(3);
    expect(await asked('2', (w) => (w.member(2).hitPoints = 10))).toBe(2);
    expect(await asked('3', (w) => (w.member(1).status = 'D'))).toBe(1);
    expect(await asked('4', (w) => (w.member(3).status = 'A'))).toBe(3);
  });

  it("a rod's who will touch it", async () => {
    const world = newWorld(7);
    world.enterDungeon(MapId.FirstDungeon);
    world.party.location = Location.Dungeon;
    [world.x, world.y, world.dungeon.heading] = [1, 1, 1];
    world.dungeon.tiles.fill(DungeonCell.Wall, 0, 256);
    world.putXYDng(DungeonCell.LadderUp, 1, 1);
    world.putXYDng(DungeonCell.Mark, 2, 1); // column 2: the mark is 0x40
    world.member(0).bytes[14] |= 0x40;
    world.member(1).hitPoints = 60;
    const io = new FakeIO(world.resources);
    io.keys = [Key.Up, Key.Escape, Key.Down, 'K']; // onto the rod, touch it with nobody, back, and up the ladder
    await runDungeon(world, io);
    expect(io.preferredMember).toBe(2);
  });
});
