/* eslint-env mocha */

const { Physics, PlayerState } = require('prismarine-physics')
const { Vec3 } = require('vec3')
const expect = require('expect')

const mcData = require('minecraft-data')('1.13.2')
const Block = require('prismarine-block')('1.13.2')

const fakeWorld = {
  getBlock: (pos) => {
    const type = (pos.y < 60) ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id
    const b = new Block(type, 0, 0)
    b.position = pos
    return b
  }
}

function fakePlayer (pos) {
  return {
    entity: {
      position: pos,
      velocity: new Vec3(0, 0, 0),
      onGround: false,
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
    version: '1.13.2',
    inventory: {
      slots: []
    }
  }
}

describe('Basic tests', () => {
  it('Gravity test', () => {
    const physics = Physics(mcData, fakeWorld)
    const controls = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false
    }
    const player = fakePlayer(new Vec3(0, 80, 0))
    const playerState = new PlayerState(player, controls)

    while (!player.entity.onGround) {
      physics.simulatePlayer(playerState, fakeWorld).apply(player)
    }

    expect(player.entity.position).toEqual(new Vec3(0, 60, 0))
  })

  // Values measured on the real 26.1.2 client walking from rest on each floor
  const mcData26 = require('minecraft-data')('26.1')
  const Block26 = require('prismarine-block')('26.1')
  function walkOn (floorName, ticks) {
    const floorId = mcData26.blocksByName[floorName].id
    const world = {
      getBlock: (pos) => {
        const type = pos.y === 59 ? floorId : (pos.y < 59 ? mcData26.blocksByName.stone.id : mcData26.blocksByName.air.id)
        const b = new Block26(type, 0, 0)
        b.position = pos
        return b
      }
    }
    const physics = Physics(mcData26, world)
    const controls = { forward: true, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
    const player = fakePlayer(new Vec3(0.5, 60, 0.5))
    player.version = '26.1'
    player.entity.onGround = true
    player.entity.velocity.y = -0.0784 // steady value while standing: (0 - gravity) * drag
    player.entity.yaw = -Math.PI / 2 // +x
    const state = new PlayerState(player, controls)
    const steps = []
    for (let i = 0; i < ticks; i++) {
      const before = player.entity.position.x
      physics.simulatePlayer(state, world).apply(player)
      steps.push(player.entity.position.x - before)
    }
    return { player, steps }
  }

  it('walks at full speed on stone', () => {
    const { steps } = walkOn('stone', 40)
    expect(steps[39]).toBeCloseTo(0.2158, 3)
  })

  it('is slowed to the block speed factor on soul sand', () => {
    const { player, steps } = walkOn('soul_sand', 40)
    expect(player.entity.position.y).toBeCloseTo(59.875, 6) // sunk into the block
    expect(steps[39]).toBeCloseTo(0.1254, 3)
  })

  it('is slowed to the block speed factor on honey', () => {
    const { player, steps } = walkOn('honey_block', 40)
    expect(player.entity.position.y).toBeCloseTo(59.9375, 6)
    expect(steps[39]).toBeCloseTo(0.1254, 3)
  })

  it('is slowed by SlimeBlock.stepOn on slime', () => {
    const { steps } = walkOn('slime_block', 40)
    // the game alternates a micro-bounce tick and a landing tick on slime; both are slower than stone
    expect(Math.max(steps[38], steps[39])).toBeLessThan(0.1)
    expect(Math.min(steps[38], steps[39])).toBeGreaterThan(0.05)
  })
})
