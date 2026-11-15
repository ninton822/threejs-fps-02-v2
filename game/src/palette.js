// The look plan, in one place: a harbor freight yard at dusk. Warm sodium lamps
// against a cold indigo sky; teal and rust containers, wooden crates, asphalt.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  sky: '#1c2033',
  ground: '#2b2622',
  wall: '#3a3542',
  containerTeal: '#2e5f6b',
  containerRust: '#8a4a2e',
  crate: '#6b5233',
  lamp: '#ffb347',
  ink: '#ece5d8',
  muted: '#8d93a8',
  enemy: '#c65b4e',
  tracer: '#ffd27a',
  smoke: '#9aa0ad',
};

export function shade(name) {
  return PALETTE[name];
}
