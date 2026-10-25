import { describe, expect, it } from 'vitest';
import { createProject, createSurface, TESTCARD_ID, type Project } from '../core/model';
import { parseProject, serializeProject } from './io';

function sampleProject(): Project {
  const p = createProject();
  p.media.push({ id: 'media-a', kind: 'video', name: 'clip.mp4', width: 3840, height: 2160, loop: false, fileKey: 'media-a' });
  const s = createSurface(p, p.media[1], 'Box front');
  s.opacity = 0.6;
  s.input[2] = { x: 0.8, y: 0.9 };
  p.surfaces.push(s);
  p.output = { width: 1280, height: 800, testPattern: true, screenLabel: 'Projector' };
  return p;
}

describe('project JSON', () => {
  it('round-trips through serialize/parse', () => {
    const p = sampleProject();
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('does not write the built-in test card to the file', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    expect(json.media.some((m: { id: string }) => m.id === TESTCARD_ID)).toBe(false);
  });

  it('points surfaces with unknown media at the test card', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    json.surfaces[1].mediaId = 'gone';
    expect(parseProject(JSON.stringify(json)).surfaces[1].mediaId).toBe(TESTCARD_ID);
  });

  it('drops malformed surfaces and clamps opacity', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    json.surfaces.push({ id: 'broken', input: [{ x: 0 }], output: [] });
    json.surfaces[0].opacity = 7;
    const p = parseProject(JSON.stringify(json));
    expect(p.surfaces).toHaveLength(2);
    expect(p.surfaces[0].opacity).toBe(1);
  });

  it('rejects invalid JSON and unknown versions with a message', () => {
    expect(() => parseProject('{nope')).toThrow(/JSON/);
    expect(() => parseProject(JSON.stringify({ version: 99 }))).toThrow(/버전/);
  });
});
