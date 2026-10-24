import { describe, it, expect } from 'vitest';
import { newWorld, FakeIO } from './helpers.ts';
import { suggestedCommands, prioritise, commandMenu } from '../src/game/context.ts';
import { MapValue } from '../src/game/tiles.ts';
import { Location } from '../src/game/party.ts';
import { MapId } from '../src/data/resources.ts';
import { PartyShape } from '../src/game/commands.ts';
import { COMMAND_MENUS } from '../src/ui/menus.ts';
import { World } from '../src/game/world.ts';
import { loadArena } from '../src/game/combat.ts';
import { BASERES } from '../src/data/resources.ts';
import { DungeonCell } from '../src/game/world.ts';
import { repelCast, repelWhyNot, spellOption } from '../src/game/spells.ts';

describe('contextual commands', () => {
  it('suggests Enter on a town and Board on a horse', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    expect(suggestedCommands(world, 'field')).toEqual([]);
    world.putXYVal(MapValue.Town, world.x, world.y);
    expect(suggestedCommands(world, 'field')).toEqual(['E']);
    world.putXYVal(MapValue.Horse, world.x, world.y);
    expect(suggestedCommands(world, 'field')).toEqual(['B']);
    world.party.shape = PartyShape.Horse;
    expect(suggestedCommands(world, 'field')).toEqual(['X']);
  });

  it('suggests Get first on a chest, whatever terrain it was left on', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    world.putXYVal(MapValue.Chest + 2, world.x, world.y); // a chest dropped on forest
    expect(suggestedCommands(world, 'field')).toEqual(['G']);
  });

  it('suggests Attack beside a monster, and Fire too from a frigate', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    const m = world.monsters;
    m.setType(0, MapValue.Orc);
    m.setPosition(0, world.x + 1, world.y);
    m.setHp(0, 0x80);
    expect(suggestedCommands(world, 'field')).toEqual(['A']);
    world.party.shape = PartyShape.Frigate;
    expect(suggestedCommands(world, 'field')).toEqual(['X', 'A', 'F']);
  });

  it('suggests Transact and Unlock in town', () => {
    const world = newWorld();
    world.enterMap(MapId.FirstTown);
    world.party.location = Location.Town;
    world.current.tiles.fill(MapValue.Floor);
    world.monsters.bytes.fill(0);
    world.x = 20;
    world.y = 20;
    world.putXYVal(MapValue.LetterA, 21, 20);
    world.putXYVal(MapValue.Merchant, 22, 20);
    world.putXYVal(MapValue.LetterI, 19, 20);
    expect(suggestedCommands(world, 'field')).toEqual(['T', 'U']);
  });

  it('suggests ladders, chests and a torch in a dungeon', () => {
    const world = newWorld();
    world.dungeon.tiles.fill(DungeonCell.Open);
    world.x = 3;
    world.y = 3;
    world.dungeon.level = 0;
    world.dungeon.torch = 5;
    world.putXYDng(DungeonCell.LadderDown | DungeonCell.Chest, 3, 3);
    expect(suggestedCommands(world, 'dungeon')).toEqual(['D', 'G']);
    world.dungeon.torch = 0;
    world.party.torches = 2;
    expect(suggestedCommands(world, 'dungeon')).toEqual(['D', 'G', 'I']);
  });

  it('suggests Attack in combat only when a monster is adjacent', () => {
    const world = newWorld();
    const c = loadArena(world, BASERES + 4);
    world.combat = c;
    c.activeMember = 0;
    c.members[0].x = 5;
    c.members[0].y = 5;
    for (const m of c.monsters) m.hp = 0;
    expect(suggestedCommands(world, 'combat')).toEqual([]);
    c.monsters[0].x = 6;
    c.monsters[0].y = 4;
    c.monsters[0].hp = 10;
    expect(suggestedCommands(world, 'combat')).toEqual([]); // diagonal: not without diagonal moves
    world.setDiagonalMoves(true);
    expect(suggestedCommands(world, 'combat')).toEqual(['A']);
  });

  it('moves suggested commands to the top of the menu without losing any', () => {
    const menu = prioritise(COMMAND_MENUS.field, ['B', 'E']);
    expect(menu.map((o) => o.key).slice(0, 2)).toEqual(['B', 'E']);
    expect(menu).toHaveLength(COMMAND_MENUS.field.length);
    expect(new Set(menu.map((o) => o.key)).size).toBe(COMMAND_MENUS.field.length);
  });
});

describe('command menu availability', () => {
  it('hides impossible commands and greys ones with nothing on hand', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    const keys = (scope: 'field' | 'combat' | 'dungeon') => commandMenu(world, scope, COMMAND_MENUS[scope]);
    const field = keys('field');
    const key = (k: string) => field.find((o) => o.key === k);
    // Plain grass, nothing around, nobody carries gems or powders.
    for (const k of ['A', 'T', 'E', 'B', 'X', 'F', 'G', 'U', 'S']) expect(key(k)).toBeUndefined();
    // Pass, Quit and save, Pause and Auto combat are not commands here: B passes, the system buttons pause, and
    // the other two are in the Pause menu.
    for (const k of [' ', 'Q']) expect(key(k)).toBeUndefined();
    expect(key('P')?.disabled).toBe(true);
    expect(key('N')?.disabled).toBe(true);
    expect(key('C')?.disabled).toBe(false); // Norric is a cleric; Pontori costs nothing
    world.member(2).status = 'D';
    world.member(3).status = 'D'; // the wizard too: only the thief and ranger... the ranger casts
    expect(keys('field').find((o) => o.key === 'C')?.disabled).toBe(false);
    world.member(1).status = 'D';
    expect(keys('field').find((o) => o.key === 'C')?.disabled).toBe(true); // only the thief is left
    // A gem makes Peer usable; a horse underfoot makes Board appear.
    world.party.gems = 1;
    world.putXYVal(MapValue.Horse, world.x, world.y);
    const again = keys('field');
    expect(again.find((o) => o.key === 'P')?.disabled).toBe(false);
    expect(again.find((o) => o.key === 'B')).toBeDefined();
    expect(again[0].key).toBe('B'); // and first, as the surroundings call for it
  });

  it('offers Steal at a shop counter with a chest behind the merchant, and only there', () => {
    const world = newWorld();
    world.enterMap(MapId.FirstTown);
    world.party.location = Location.Town;
    world.monsters.bytes.fill(0);
    const steal = () => commandMenu(world, 'field', COMMAND_MENUS.field).some((o) => o.key === 'S');
    world.x = 36; // Britain's shop: the counter north of here, the chest at (36, 16) behind the merchant's row
    world.y = 19;
    expect(steal()).toBe(true);
    world.x = 37; // a step along the counter: no chest behind it there
    expect(steal()).toBe(false);
  });

  it("offers Enter only where the place stands: not on Dawn's square while it is forest", () => {
    const world = newWorld();
    world.monsters.bytes.fill(0);
    const { locationX, locationY } = world.resources.misc;
    [world.x, world.y] = [locationX[8], locationY[8]]; // Dawn
    const enter = () => commandMenu(world, 'field', COMMAND_MENUS.field).some((o) => o.key === 'E');
    world.putXYVal(MapValue.Forest, world.x, world.y);
    expect(enter()).toBe(false);
    world.putXYVal(MapValue.Town, world.x, world.y); // both moons new
    expect(enter()).toBe(true);
  });

  it('offers X-it only where the mount can be left: a horse on grass, a ship on water', () => {
    const world = newWorld();
    world.monsters.bytes.fill(0);
    const xit = () => commandMenu(world, 'field', COMMAND_MENUS.field).some((o) => o.key === 'X');
    world.party.shape = PartyShape.Horse;
    world.putXYVal(MapValue.Brush, world.x, world.y);
    expect(xit()).toBe(false);
    world.putXYVal(MapValue.Grass, world.x, world.y);
    expect(xit()).toBe(true);
  });

  it("offers Unlock first beside one of Ambrosia's doors, greyed without a key", () => {
    const world = newWorld();
    world.enterMap(MapId.Ambrosia);
    world.party.location = Location.Ambrosia;
    world.monsters.bytes.fill(0);
    world.x = 11; // east of the door at (10, 6), before the shrine at (6, 6)
    world.y = 6;
    world.party.keys = 2;
    const menu = () => commandMenu(world, 'field', COMMAND_MENUS.field);
    expect(menu()[0]).toMatchObject({ key: 'U', disabled: false });
    world.party.keys = 0;
    expect(menu().find((o) => o.key === 'U')?.disabled).toBe(true);
    world.x = 12; // a step away: no door beside the party
    expect(menu().find((o) => o.key === 'U')).toBeUndefined();
  });

  it('shows ladders only when standing on one, and greys the torch when none is carried', () => {
    const world = newWorld();
    world.dungeon.tiles.fill(DungeonCell.Open);
    world.x = 3;
    world.y = 3;
    world.dungeon.level = 0;
    const menu = () => commandMenu(world, 'dungeon', COMMAND_MENUS.dungeon);
    expect(menu().find((o) => o.key === 'K')).toBeUndefined();
    expect(menu().find((o) => o.key === 'I')?.disabled).toBe(true);
    world.putXYDng(DungeonCell.LadderUp, 3, 3);
    world.party.torches = 1;
    expect(menu().find((o) => o.key === 'K')).toBeDefined();
    expect(menu().find((o) => o.key === 'I')?.disabled).toBe(false);
  });
});

describe('the combat menu reads the turn', () => {
  function fight(member: number) {
    const world = newWorld();
    const c = loadArena(world, BASERES + 4);
    world.combat = c;
    c.activeMember = member;
    c.members[member].x = 5;
    c.members[member].y = 5;
    for (const m of c.monsters) m.hp = 0;
    return world;
  }
  const keys = (world: World) => commandMenu(world, 'combat', COMMAND_MENUS.combat).map((o) => o.key + ':' + o.label);

  it('puts a ranged weapon first, then the quick spell, then Cast', () => {
    const world = fight(1); // Roderic, a ranger: wizard and cleric spells, dagger in hand
    world.member(1).bytes[48] = 5; // a bow
    expect(keys(world).slice(0, 3)).toEqual(['A:Attack (Bow)', '!:Cast (Magic bolt)', 'C:Cast spell']);
  });

  it('counts a dagger as ranged only with a spare, and names the last spell cast', () => {
    const world = fight(1);
    world.party.setWeapons(1, 0);
    world.lastSpell[1] = 5; // Fireball
    expect(keys(world).slice(0, 3)).toEqual(['!:Cast (Fireball)', 'C:Cast spell', 'A:Attack']);
    world.party.setWeapons(1, 1);
    expect(keys(world)[0]).toBe('A:Attack (Dagger)');
  });

  it('offers no quick spell to a fighter and greys one the caster cannot afford', () => {
    const thief = fight(0);
    expect(keys(thief).some((k) => k.startsWith('!'))).toBe(false);
    const world = fight(1);
    world.member(1).mana = 0;
    const quick = commandMenu(world, 'combat', COMMAND_MENUS.combat).find((o) => o.key === '!');
    expect(quick?.disabled).toBe(true);
  });
});

describe('the Repel spells', () => {
  /** A fight against foes of `shape` (0x30 orcs, 0x32 undead), on `member`'s turn: Tatiana a thief, Roderic a ranger, Norric a cleric, Ghiselle a wizard. */
  function fight(member: number, shape: number) {
    const world = newWorld();
    const c = loadArena(world, BASERES + 4);
    world.combat = c;
    world.party.location = Location.Combat;
    c.monsterShape = shape;
    c.activeMember = member;
    c.members[member].x = 5;
    c.members[member].y = 5;
    for (const m of c.monsters) m.hp = 0;
    return world;
  }
  const keys = (world: World) => commandMenu(world, 'combat', COMMAND_MENUS.combat).map((o) => o.key + ':' + o.label);

  it("say why they would fail: out of a fight, foes not their type, the fight's try spent", () => {
    const world = fight(1, 0x30);
    expect(repelWhyNot(world, 0)).toBe(null);
    expect(repelWhyNot(world, 16)).toBe('No undead here.');
    world.spellFlags.repond = true;
    expect(repelWhyNot(world, 0)).toBe('Tried already this fight.');
    world.party.location = Location.Sosaria;
    expect(repelWhyNot(world, 0)).toBe('Only in a fight.');
    expect(repelWhyNot(world, 1)).toBe(null); // any other spell
  });

  it('lead the combat menu where one would work, for a class that casts it', () => {
    expect(keys(fight(1, 0x30))[0]).toBe('%:Cast (Repel orcs)'); // the ranger, either book
    expect(keys(fight(1, 0x32))[0]).toBe('%:Cast (Repel undead)');
    expect(keys(fight(3, 0x30))[0]).toBe('%:Cast (Repel orcs)'); // the wizard
    expect(keys(fight(2, 0x32))[0]).toBe('%:Cast (Repel undead)'); // the cleric
  });

  it('are left off the menu where they would not work', () => {
    const none = (world: World) => expect(keys(world).some((k) => k.startsWith('%'))).toBe(false);
    none(fight(0, 0x30)); // a thief casts nothing
    none(fight(3, 0x32)); // a wizard has no Repel undead
    none(fight(2, 0x30)); // nor a cleric Repel orcs
    none(fight(1, 0x34)); // giants: neither
    const spent = fight(1, 0x30);
    spent.spellFlags.repond = true;
    none(spent);
  });

  it('keep the quick spell off a Repel spell that would not work, and do not repeat one that would', () => {
    const giants = fight(1, 0x34);
    giants.lastSpell[1] = 0; // Repel orcs, last cast
    expect(keys(giants)[0]).toBe('!:Cast (Magic bolt)');
    const orcs = fight(1, 0x30);
    orcs.lastSpell[1] = 0;
    expect(keys(orcs).slice(0, 2)).toEqual(['%:Cast (Repel orcs)', 'C:Cast spell']);
  });

  it('are greyed in the spell lists where they would not work, the card saying why', () => {
    const world = fight(1, 0x34);
    const option = spellOption(world, 0, 'A', 1);
    expect(option.disabled).toBe(true);
    expect(option.card!.lines.slice(-1)).toEqual([{ text: 'No orcs here.', tone: 'worse' }]);
    world.combat!.monsterShape = 0x30;
    expect(spellOption(world, 0, 'A', 1).disabled).toBe(false);
    world.spellFlags.repond = true;
    expect(
      spellOption(world, 0, 'A', 1)
        .card!.lines.slice(-2)
        .map((l) => l.text),
    ).toEqual(['Tried already', 'this fight.']);
    // Every spell's card still fits the panel, a Repel spell's reason with it.
    for (const state of [
      { shape: 0x30, spent: true },
      { shape: 0x34, spent: false },
    ]) {
      const w = fight(1, state.shape);
      w.spellFlags = { repond: state.spent, pontori: state.spent };
      for (let spell = 0; spell < 35; spell++) expect(spellOption(w, spell, 'A', 1).card!.lines.length).toBeLessThanOrEqual(11);
    }
  });

  it("cast from the menu's line spends the fight's try and becomes the last spell", async () => {
    const world = fight(1, 0x30);
    const io = new FakeIO(world.resources);
    expect(await repelCast(world, io, 1)).toBe(true);
    expect(world.spellFlags.repond).toBe(true);
    expect(world.lastSpell[1]).toBe(0);
    expect(await repelCast(world, io, 1)).toBe(false); // nothing left to cast
  });
});

describe('the combat menu for a non-caster', () => {
  it('leaves Cast where it was', () => {
    const world = newWorld();
    const c = loadArena(world, BASERES + 4);
    world.combat = c;
    c.activeMember = 0; // the thief
    for (const m of c.monsters) m.hp = 0;
    const keys = commandMenu(world, 'combat', COMMAND_MENUS.combat).map((o) => o.key);
    expect(keys[0]).toBe('A');
    expect(keys.includes('!')).toBe(false);
  });
});

describe('View map', () => {
  it('is in the field menu wherever the party is, Ambrosia too, and in the dungeon menu', () => {
    const world = newWorld();
    const labels = () => commandMenu(world, 'field', COMMAND_MENUS.field).map((o) => o.label);
    expect(labels()).toContain('View map');
    world.party.location = Location.Ambrosia;
    expect(labels()).toContain('View map');
    expect(COMMAND_MENUS.dungeon.map((o) => o.label)).toContain('View map');
  });
});
