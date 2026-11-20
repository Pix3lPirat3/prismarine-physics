/* eslint-env mocha */

const { Physics, PlayerState } = require('prismarine-physics')
const { Vec3 } = require('vec3')
const expect = require('expect')

// One tick of movement next to, onto and into every block state whose collision box is not a
// full cube, against what the game's own Entity.collide gives for the same box and movement.
//
// Each fixture is [state, start, movement, onGround, expected movement, horizontal collision,
// on ground after]. The block stands at 0 64 0 on a stone floor; the player starts at `start`,
// with `movement` as its velocity and no keys held, so the tick moves it by exactly what the
// collision allows. The expected values were taken from the 26.1.2 server jar: the blocks'
// shapes from BlockState.getCollisionShape and the movement from Entity.collide (with its
// collideWithShapes and collectCandidateStepUpHeights). They are every case the old collision
// code got wrong among 495414 (324 distinct shapes, 28 starts round each, three directions,
// walking, jumping and falling), and every 250th of the others.

const version = '26.1'
const mcData = require('minecraft-data')(version)
const Block = require('prismarine-block')(version)
const fixtures = require('./fixtures/collisions-26.1.json')

function stateOf (text) {
  const i = text.indexOf('[')
  const name = i < 0 ? text : text.slice(0, i)
  const props = i < 0 ? {} : Object.fromEntries(text.slice(i + 1, -1).split(',').map(p => p.split('=')))
  return Block.fromProperties(mcData.blocksByName[name].id, props, 0).stateId
}

function worldWith (stateId) {
  const stone = mcData.blocksByName.stone.defaultState
  const air = mcData.blocksByName.air.defaultState
  return {
    getBlock: (pos) => {
      let id = air
      if (pos.x === 0 && pos.y === 64 && pos.z === 0) id = stateId
      else if (pos.y === 63 && pos.x >= -2 && pos.x <= 3 && pos.z >= -2 && pos.z <= 3) id = stone
      const block = Block.fromStateId(id, 0)
      block.position = new Vec3(pos.x, pos.y, pos.z)
      return block
    }
  }
}

function tick (world, start, move, onGround) {
  const physics = Physics(mcData, world)
  const bot = {
    version,
    registry: mcData,
    entity: {
      position: new Vec3(...start),
      velocity: new Vec3(...move),
      onGround,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      elytraFlying: false,
      yaw: 0,
      pitch: 0,
      effects: {}
    },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    inventory: { slots: [] }
  }
  const state = new PlayerState(bot, { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false })
  physics.simulatePlayer(state, world)
  return state
}

describe('collisions against blocks smaller than a block, as the game has them', () => {
  const byState = new Map()
  for (const f of fixtures) {
    if (!byState.has(f[0])) byState.set(f[0], [])
    byState.get(f[0]).push(f)
  }
  for (const [text, cases] of byState) {
    it(`${text}: ${cases.length} cases`, () => {
      const world = worldWith(stateOf(text))
      const wrong = []
      for (const [, start, move, onGround, want, hc, ground] of cases) {
        const s = tick(world, start, move, onGround === 1)
        const got = [s.pos.x - start[0], s.pos.y - start[1], s.pos.z - start[2]]
        const off = Math.max(...got.map((g, i) => Math.abs(g - want[i])))
        if (off > 1e-9 || s.isCollidedHorizontally !== (hc === 1) || s.onGround !== (ground === 1)) {
          wrong.push(`from ${start} by ${move}: moved ${got.map(v => v.toFixed(4))}, the game ${want.map(v => v.toFixed(4))}; collided ${s.isCollidedHorizontally} (${hc === 1}), on ground ${s.onGround} (${ground === 1})`)
        }
      }
      expect(wrong).toEqual([])
    })
  }
})
