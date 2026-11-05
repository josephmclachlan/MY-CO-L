import { describe, expect, it } from 'vitest'
import { isTypingKey, pickNext, type Box } from './keynav'

const b = (left: number, top: number, w = 40, h = 20): Box => ({ left, top, right: left + w, bottom: top + h })

describe('pickNext', () => {
  const list = [b(0, 0), b(0, 30), b(0, 60)]
  it('moves down and up a list', () => {
    expect(pickNext(list[0], list, 'down')).toBe(1)
    expect(pickNext(list[2], list, 'up')).toBe(1)
    expect(pickNext(list[2], list, 'down')).toBe(-1)
  })
  it('takes the nearest row before a better-aligned item further down', () => {
    const tabs = b(0, 0, 90, 26)
    const firstRow = b(250, 150)
    const lower = b(200, 220)
    expect(pickNext(tabs, [lower, firstRow], 'down')).toBe(1)
  })
  it('picks the item straight below inside a grid row', () => {
    const grid = [b(0, 0), b(50, 0), b(100, 0), b(0, 30), b(50, 30), b(100, 30)]
    expect(pickNext(grid[1], grid, 'down')).toBe(4)
    expect(pickNext(grid[4], grid, 'left')).toBe(3)
    expect(pickNext(grid[4], grid, 'right')).toBe(5)
  })
  it('does not jump left or right to a far-away row', () => {
    expect(pickNext(b(100, 0), [b(0, 400)], 'left', 48)).toBe(-1)
  })
})

describe('isTypingKey', () => {
  it('treats letters as typing and space or shortcuts as not', () => {
    expect(isTypingKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBe(true)
    expect(isTypingKey({ key: ' ', ctrlKey: false, metaKey: false, altKey: false })).toBe(false)
    expect(isTypingKey({ key: 'c', ctrlKey: true, metaKey: false, altKey: false })).toBe(false)
    expect(isTypingKey({ key: 'ArrowUp', ctrlKey: false, metaKey: false, altKey: false })).toBe(false)
  })
})
