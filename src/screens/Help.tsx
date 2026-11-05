import { TypeText } from '../components/TypeText'

export const HELP_LINES = [
  'COMMANDS',
  '  MENU            MAIN MENU',
  '  1-9 OR NAME     OPEN A MODULE (E.G. 2 OR VITALS)',
  '  TUNE            LOOK AND SOUND SETTINGS',
  '  THEME <NAME>    PHOSPHOR, CRYO, SODIUM OR ALERT',
  '  CLEAN           SUNLIGHT MODE ON OR OFF',
  '  MUTE            SOUND ON OR OFF',
  '  CHATTER / TICK  SOUND MODE',
  '  BOOT            REPLAY THE BOOT SEQUENCE',
  '  STATUS          SYSTEM STATUS',
  '  LOGIN / LOGOUT  DATABASE ACCESS',
  '',
  'POWER AND ROOMS',
  '  UTILITY / GEN   SWITCH THE POWER SOURCE (OPENS VITALS)',
  '  HEATER A / B    2 X 4,500 W OR 1 X 6,500 W STEAM HEATER',
  '  BASELINE        CONTINUOUS LOADS ONLY',
  '  EMERGENCY       GENERATOR EMERGENCY LIST',
  '  S1-S18, 13-18   FLIP A BREAKER BY ITS TAG',
  '  LAB, PACKING,   OPEN A ROOM ON THE DECK PLAN',
  '  INCUBATION, FRUITING, BOILING',
  '',
  'KEYS',
  '  F1-F8           FUNCTION BAR (OR TAP IT)',
  '  ARROWS + ENTER  MOVE AND OPEN IN THE MENU',
]

export function Help() {
  return (
    <div>
      <div className="section-title">HELP</div>
      <TypeText group={3} lines={HELP_LINES} />
    </div>
  )
}
