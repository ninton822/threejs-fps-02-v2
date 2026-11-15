// Rounds: the match is first to 5, at most 9 rounds. Each round opens with a
// 15-second buy phase, then 100 seconds of live play. Vanguard (the player
// and four bots) attacks the Pier site; Sentinel defends it. A round ends when
// one team is eliminated, the charge detonates or is defused, or the clock
// runs out with no plant. Money is the player's only economy: kills, plants
// and round results pay, and the buy menu spends it between rounds.
import * as THREE from 'three';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const BOMB_FUSE = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export const WIN_PAY = 3250;
export const LOSS_PAY = 1900;
export const KILL_PAY = 300;
export const PLANT_PAY = 300;

export function createRounds(ctx) {
  const rounds = {
    round: 1,
    scoreVan: 0,
    scoreSen: 0,
    phase: 'buy',
    phaseTime: BUY_TIME,
    money: 800,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    bomb: {
      state: 'carried', // carried | dropped | planted | gone
      carrier: null,
      position: new THREE.Vector3(0, 0, -13),
      fuse: BOMB_FUSE,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
    },
    lastResult: null,

    startMatch() {
      this.round = 1;
      this.scoreVan = 0;
      this.scoreSen = 0;
      this.money = 800;
      this.kills = 0;
      this.deaths = 0;
      this.plants = 0;
      this.defuses = 0;
      this.lastResult = null;
      this.startRound();
    },

    startRound() {
      this.phase = 'buy';
      this.phaseTime = BUY_TIME;
      this.bomb.state = 'carried';
      // The carrier lives on the rounds object, set by main.js once
      // playerTarget exists (the config's playerTarget stays null: the
      // object passed to createRounds is not the rounds object, so
      // reading ctx.playerTarget here left the carrier null and the
      // player could never plant).
      this.bomb.carrier = this.playerTarget;
      this.bomb.position.set(0, 0, -13);
      this.bomb.fuse = BOMB_FUSE;
      this.bomb.plantProgress = 0;
      this.bomb.defuseProgress = 0;
      this.bomb.defuser = null;
      ctx.onRoundStart(this.round);
    },

    endRound(winner, reason) {
      if (this.phase === 'end' || this.phase === 'matchEnd') return;
      this.phase = 'end';
      this.phaseTime = 4;
      if (winner === 'van') this.scoreVan += 1;
      else this.scoreSen += 1;
      const playerWon = winner === 'van';
      this.money += playerWon ? WIN_PAY : LOSS_PAY;
      this.lastResult = { winner, reason, round: this.round };
      ctx.onRoundEnd(winner, reason, playerWon);
    },

    endMatch() {
      this.phase = 'matchEnd';
      ctx.onMatchEnd(this.scoreVan > this.scoreSen ? 'van' : 'sen');
    },

    nextRound() {
      this.round += 1;
      if (this.scoreVan >= WIN_ROUNDS || this.scoreSen >= WIN_ROUNDS || this.round > MAX_ROUNDS) {
        this.endMatch();
        return;
      }
      this.startRound();
      ctx.onRoundReset();
    },

    step(dt) {
      if (this.phase === 'buy') {
        this.phaseTime -= dt;
        if (this.phaseTime <= 0) {
          this.phase = 'live';
          this.phaseTime = ROUND_TIME;
          ctx.onLive();
        }
        return;
      }
      if (this.phase !== 'live') {
        if (this.phase === 'end') {
          this.phaseTime -= dt;
          if (this.phaseTime <= 0) this.nextRound();
        }
        return;
      }
      this.phaseTime -= dt;
      // Bomb fuse while planted.
      if (this.bomb.state === 'planted') {
        this.bomb.fuse -= dt;
        if (this.bomb.fuse <= 0) {
          this.endRound('van', 'The charge detonated at the Pier.');
          ctx.onDetonate();
          return;
        }
      }
      // Win checks.
      const vanAlive = ctx.aliveCount('van');
      const senAlive = ctx.aliveCount('sen');
      if (senAlive === 0) {
        this.endRound('van', this.bomb.state === 'planted' ? 'Site cleared — the charge will detonate.' : 'Sentinel team eliminated.');
        return;
      }
      if (vanAlive === 0) {
        this.endRound('sen', 'Vanguard team eliminated.');
        return;
      }
      if (this.phaseTime <= 0) {
        this.endRound('sen', 'Time expired — the charge was never planted.');
      }
    },

    // The player (or a bot) finished the plant channel inside the site.
    plant(by) {
      if (this.phase !== 'live' || this.bomb.state !== 'carried') return false;
      this.bomb.state = 'planted';
      this.bomb.position.copy(by.position);
      this.bomb.fuse = BOMB_FUSE;
      this.bomb.plantProgress = 0;
      if (by.isPlayer) {
        this.money += PLANT_PAY;
        this.plants += 1;
      }
      ctx.onPlanted(by);
      return true;
    },

    defuse(by) {
      if (this.phase !== 'live' || this.bomb.state !== 'planted') return false;
      this.bomb.state = 'gone';
      if (by.isPlayer) this.defuses += 1;
      this.endRound('sen', 'The charge was defused.');
      ctx.onDefused(by);
      return true;
    },

    // The carrier died: the charge drops where they fell.
    dropBomb(at) {
      if (this.bomb.state !== 'carried') return;
      this.bomb.state = 'dropped';
      this.bomb.carrier = null;
      this.bomb.position.copy(at);
      this.bomb.position.y = 0.15;
      ctx.onBombDropped(this.bomb.position);
    },

    // An attacker walking over a dropped charge picks it up.
    tryPickup(who) {
      if (this.bomb.state !== 'dropped') return false;
      if (who.position.distanceTo(this.bomb.position) > 1.2) return false;
      this.bomb.state = 'carried';
      this.bomb.carrier = who;
      ctx.onBombPickedUp(who);
      return true;
    },
  };
  return rounds;
}
