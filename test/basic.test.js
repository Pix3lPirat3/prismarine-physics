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
})

describe('Sprint state', () => {
  // LocalPlayer.aiStep decides whether the player is sprinting from the sprint key, the forward input, sneaking
  // and the previous tick's horizontal collision; the engine mirrors it in entity.isSprinting
  function makeWorld (version, wallAt) {
    const data = require('minecraft-data')(version)
    const VBlock = require('prismarine-block')(version)
    const world = {
      wall: true,
      getBlock: (pos) => {
        const solid = pos.y < 60 || (world.wall && wallAt(pos))
        const b = new VBlock(solid ? data.blocksByName.stone.id : data.blocksByName.air.id, 0, 0)
        b.position = pos
        return b
      }
    }
    return { data, world }
  }

  function makePlayer (version, pos, yaw) {
    const player = fakePlayer(pos)
    player.version = version
    player.entity.onGround = true
    player.entity.velocity = new Vec3(0, -0.0784, 0)
    player.entity.yaw = yaw ?? Math.PI // face +z
    return player
  }

  function tick (physics, world, player, controls) {
    const before = player.entity.position.clone()
    physics.simulatePlayer(new PlayerState(player, { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, ...controls }), world).apply(player)
    return player.entity.position.minus(before)
  }

  it('stops sprinting for the tick after a head-on collision and starts again once free', () => {
    const { data, world } = makeWorld('26.1', (pos) => pos.z === 5 && pos.y < 62)
    const physics = Physics(data, world)
    const player = makePlayer('26.1', new Vec3(0.5, 60, 3.5))
    let moved
    for (let i = 0; i < 20 && !player.entity.isCollidedHorizontally; i++) {
      moved = tick(physics, world, player, { forward: true, sprint: true })
      expect(player.entity.isSprinting).toBe(true)
    }
    // the first touch still moved forward a little, which the client counts as a minor collision
    expect(player.entity.isCollidedHorizontally).toBe(true)
    expect(player.entity.minorHorizontalCollision).toBe(true)
    moved = tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(true)
    expect(moved.z).toBe(0) // pressed against the wall: this collision is not minor
    expect(player.entity.minorHorizontalCollision).toBe(false)
    world.wall = false // the way is clear again: the client still runs this tick without the sprint
    moved = tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(false)
    expect(moved.z).toBeCloseTo(0.098, 4) // walking acceleration from rest, not 0.1274
    moved = tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(true)
    expect(moved.z).toBeCloseTo(0.098 * 0.91 * 0.6 + 0.1274, 2)
  })

  it('keeps sprinting through a minor brush against a wall, drops it for a wider angle (1.18+)', () => {
    for (const [angle, minor] of [[4, true], [12, false]]) {
      const { data, world } = makeWorld('26.1', (pos) => pos.x === -1 && pos.y < 62)
      const physics = Physics(data, world)
      // wanted direction: forward turned `angle` degrees towards the wall on the -x side
      const player = makePlayer('26.1', new Vec3(0.5, 60, 0.5), Math.PI - angle * Math.PI / 180)
      // run until pressed against the wall (the first touch still moves towards it, a minor collision)
      let moved = new Vec3(1, 0, 0)
      for (let i = 0; i < 60 && !(player.entity.isCollidedHorizontally && moved.x === 0); i++) moved = tick(physics, world, player, { forward: true, sprint: true })
      expect(player.entity.isCollidedHorizontally).toBe(true)
      expect(player.entity.isSprinting).toBe(true)
      expect(player.entity.minorHorizontalCollision).toBe(minor)
      tick(physics, world, player, { forward: true, sprint: true })
      expect(player.entity.isSprinting).toBe(minor)
    }
  })

  it('keeps sprinting through a minor brush from diagonal (forward+right) input', () => {
    // A diagonal input reaching the wall at the same shallow angle as a forward-only brush must also count as minor.
    // The old collision check flipped the strafe sign, so it mis-classified strafe-containing brushes and dropped sprint.
    const { data, world } = makeWorld('26.1', (pos) => pos.x === -1 && pos.y < 62)
    const physics = Physics(data, world)
    const player = makePlayer('26.1', new Vec3(0.5, 60, 0.5), 49 * Math.PI / 180)
    let moved = new Vec3(1, 0, 0)
    for (let i = 0; i < 60 && !(player.entity.isCollidedHorizontally && moved.x === 0); i++) moved = tick(physics, world, player, { forward: true, right: true, sprint: true })
    expect(player.entity.isCollidedHorizontally).toBe(true)
    expect(player.entity.isSprinting).toBe(true)
    expect(player.entity.minorHorizontalCollision).toBe(true)
    tick(physics, world, player, { forward: true, right: true, sprint: true })
    expect(player.entity.isSprinting).toBe(true)
  })

  it('treats every collision as a full stop before 1.18', () => {
    const { data, world } = makeWorld('1.16.5', (pos) => pos.x === -1 && pos.y < 62)
    const physics = Physics(data, world)
    const player = makePlayer('1.16.5', new Vec3(0.5, 60, 0.5), Math.PI - 4 * Math.PI / 180)
    let moved = new Vec3(1, 0, 0)
    for (let i = 0; i < 60 && !(player.entity.isCollidedHorizontally && moved.x === 0); i++) moved = tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isCollidedHorizontally).toBe(true)
    expect(player.entity.minorHorizontalCollision).toBe(true) // the same brush as above
    tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(false) // but no minor-collision rule before 1.18
  })

  it('needs forward input to sprint', () => {
    const { data, world } = makeWorld('26.1', () => false)
    const physics = Physics(data, world)
    const player = makePlayer('26.1', new Vec3(0.5, 60, 0.5))
    const moved = tick(physics, world, player, { right: true, sprint: true })
    expect(player.entity.isSprinting).toBe(false)
    expect(Math.abs(moved.x)).toBeCloseTo(0.098, 4)
    tick(physics, world, player, { forward: true, back: true, sprint: true })
    expect(player.entity.isSprinting).toBe(false)
    tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(true)
    tick(physics, world, player, { forward: false, sprint: true })
    expect(player.entity.isSprinting).toBe(false)
    tick(physics, world, player, { forward: true, sprint: true })
    expect(player.entity.isSprinting).toBe(true)
    tick(physics, world, player, { forward: true, sprint: false }) // releasing the key stops at once (control contract)
    expect(player.entity.isSprinting).toBe(false)
  })

  it('sneaking prevents a sprint from starting and, before 1.14, stops one', () => {
    for (const [version, stops] of [['26.1', false], ['1.8.8', true]]) {
      const { data, world } = makeWorld(version, () => false)
      const physics = Physics(data, world)
      const player = makePlayer(version, new Vec3(0.5, 60, 0.5))
      tick(physics, world, player, { forward: true, sprint: true, sneak: true })
      expect(player.entity.isSprinting).toBe(false)
      tick(physics, world, player, { forward: true, sprint: true })
      expect(player.entity.isSprinting).toBe(true)
      tick(physics, world, player, { forward: true, sprint: true, sneak: true })
      expect(player.entity.isSprinting).toBe(!stops)
    }
  })
})
