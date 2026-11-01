import { describe, expect, it } from 'vitest';
import { createLayer, createProject, createSurface, TESTCARD_ID, type Project } from '../core/model';
import { parseProject, serializeProject } from './io';

function sampleProject(): Project {
  const p = createProject();
  p.media.push({ id: 'media-a', kind: 'video', name: 'clip.mp4', width: 3840, height: 2160, loop: false, fileKey: 'media-a' });
  const s = createSurface(p, p.media[1], 'Box front');
  s.opacity = 0.6;
  s.layers[0].input[2] = { x: 0.8, y: 0.9 };
  s.layers.push({ ...createLayer(TESTCARD_ID, 'Glow'), opacity: 0.5, blend: 'screen' });
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

  it('points layers with unknown media at the test card', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    json.surfaces[1].layers[0].mediaId = 'gone';
    expect(parseProject(JSON.stringify(json)).surfaces[1].layers[0].mediaId).toBe(TESTCARD_ID);
  });

  it('turns a surface saved before layers into one layer', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    const legacy = json.surfaces[1];
    const { input, mediaId } = legacy.layers[0];
    delete legacy.layers;
    Object.assign(legacy, { input, mediaId });
    const layers = parseProject(JSON.stringify(json)).surfaces[1].layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ mediaId: 'media-a', input, opacity: 1, blend: 'normal', visible: true });
  });

  it('defaults unknown blend modes and drops surfaces without valid layers', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    json.surfaces[1].layers[1].blend = 'overlay';
    json.surfaces[0].layers = [{ input: 'bad' }];
    const p = parseProject(JSON.stringify(json));
    expect(p.surfaces).toHaveLength(1);
    expect(p.surfaces[0].layers[1].blend).toBe('normal');
  });

  it('drops malformed surfaces and clamps opacity', () => {
    const json = JSON.parse(serializeProject(sampleProject()));
    json.surfaces.push({ id: 'broken', layers: [], output: [] });
    json.surfaces[0].opacity = 7;
    const p = parseProject(JSON.stringify(json));
    expect(p.surfaces).toHaveLength(2);
    expect(p.surfaces[0].opacity).toBe(1);
  });

  it('keeps capture media (live sources have no stored file)', () => {
    const p = sampleProject();
    p.media.push({ id: 'capture-a', kind: 'capture', name: 'YouTube 탭', width: 1280, height: 720, loop: true });
    const back = parseProject(serializeProject(p));
    expect(back.media.find((m) => m.id === 'capture-a')).toEqual({ id: 'capture-a', kind: 'capture', name: 'YouTube 탭', width: 1280, height: 720, loop: true, fileKey: undefined });
  });

  it('rejects invalid JSON and unknown versions with a message', () => {
    expect(() => parseProject('{nope')).toThrow(/JSON/);
    expect(() => parseProject(JSON.stringify({ version: 99 }))).toThrow(/버전/);
  });
});
