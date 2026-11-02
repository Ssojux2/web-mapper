import { describe, expect, it } from 'vitest';
import { activeLayer, createLayer, createMediaSurface, createMesh, createProject, createSurface, mediaUsage, moveLayerInSurface, removeMedia, TESTCARD_ID, updateSurface } from './model';
import { createEditorStore } from './store';
import { translateQuad } from './geometry';

function setup() {
  const store = createEditorStore(createProject());
  const id = store.getState().project.surfaces[0].id;
  return { store, id };
}

describe('editor store history', () => {
  it('undoes and redoes recorded changes', () => {
    const { store, id } = setup();
    store.getState().apply((p) => updateSurface(p, id, { opacity: 0.5 }));
    store.getState().apply((p) => updateSurface(p, id, { opacity: 0.25 }));
    expect(store.getState().project.surfaces[0].opacity).toBe(0.25);

    store.getState().undo();
    expect(store.getState().project.surfaces[0].opacity).toBe(0.5);
    store.getState().undo();
    expect(store.getState().project.surfaces[0].opacity).toBe(1);
    store.getState().undo(); // nothing left: no-op
    expect(store.getState().project.surfaces[0].opacity).toBe(1);

    store.getState().redo();
    store.getState().redo();
    expect(store.getState().project.surfaces[0].opacity).toBe(0.25);
  });

  it('records a whole drag gesture as one undo step', () => {
    const { store, id } = setup();
    const start = store.getState().project.surfaces[0].output;
    store.getState().beginGesture();
    for (let i = 1; i <= 10; i++) {
      store.getState().apply((p) => updateSurface(p, id, { output: translateQuad(start, i, i) }), { record: false });
    }
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().project.surfaces[0].output[0].x).toBe(start[0].x + 10);

    store.getState().undo();
    expect(store.getState().project.surfaces[0].output).toEqual(start);
  });

  it('a gesture without changes leaves no history entry', () => {
    const { store } = setup();
    store.getState().beginGesture();
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(0);
  });

  it('a new change clears the redo stack', () => {
    const { store, id } = setup();
    store.getState().apply((p) => updateSurface(p, id, { opacity: 0.5 }));
    store.getState().undo();
    store.getState().apply((p) => updateSurface(p, id, { visible: false }));
    expect(store.getState().future).toHaveLength(0);
  });

  it('drops the selection when undo removes the selected surface', () => {
    const { store } = setup();
    let addedId = '';
    store.getState().apply((p) => {
      const s = createSurface(p, p.media[0]);
      addedId = s.id;
      return { ...p, surfaces: [...p.surfaces, s] };
    });
    store.getState().select({ surfaceId: addedId, corner: 2 });
    store.getState().undo();
    expect(store.getState().selection.surfaceId).toBeNull();
    expect(store.getState().selection.corner).toBeNull();
  });

  it('switching surface clears mesh point and mask selection', () => {
    const { store, id } = setup();
    store.getState().apply((p) => updateSurface(p, id, { mesh: createMesh(2, 2), masks: [{ id: 'm1', name: 'M', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }], invert: false, feather: 0, enabled: true }] }));
    store.getState().select({ point: 4, maskId: 'm1', maskPoint: 1 });
    expect(store.getState().selection).toMatchObject({ point: 4, maskId: 'm1', maskPoint: 1 });

    let other = '';
    store.getState().apply((p) => {
      const s = createSurface(p, p.media[0]);
      other = s.id;
      return { ...p, surfaces: [...p.surfaces, s] };
    });
    store.getState().select({ surfaceId: other });
    expect(store.getState().selection).toMatchObject({ surfaceId: other, point: null, maskId: null, maskPoint: null });
  });

  it('drops a mesh point selection when undo removes the mesh', () => {
    const { store, id } = setup();
    store.getState().apply((p) => updateSurface(p, id, { mesh: createMesh(2, 2) }));
    store.getState().select({ point: 4 });
    store.getState().undo();
    expect(store.getState().selection.point).toBeNull();
  });
});

describe('surface layers', () => {
  function withLayers() {
    const { store, id } = setup();
    const p0 = store.getState().project;
    p0.media.push({ id: 'clip', kind: 'video', name: 'clip.mp4', width: 1920, height: 1080, loop: true });
    const s = p0.surfaces[0];
    const top = createLayer('clip', 'Top');
    store.getState().apply((p) => updateSurface(p, id, { layers: [...s.layers, top] }));
    return { store, id, base: s.layers[0], top };
  }

  it('works on the selected layer, else the top one', () => {
    const { store, id, base, top } = withLayers();
    const surface = store.getState().project.surfaces[0];
    expect(activeLayer(surface, null)).toBe(surface.layers[1]);
    expect(activeLayer(surface, base.id).id).toBe(base.id);
    store.getState().select({ surfaceId: id, layerId: top.id });
    expect(store.getState().selection.layerId).toBe(top.id);
  });

  it('reorders layers inside a surface', () => {
    const { store, id, base, top } = withLayers();
    store.getState().apply((p) => moveLayerInSurface(p, id, top.id, -1));
    expect(store.getState().project.surfaces[0].layers.map((l) => l.id)).toEqual([top.id, base.id]);
    const before = store.getState().project;
    store.getState().apply((p) => moveLayerInSurface(p, id, top.id, -1)); // already at the bottom
    expect(store.getState().project).toBe(before);
  });

  it('counts usage per surface and falls back to the test card when media is removed', () => {
    const { store } = withLayers();
    const p = store.getState().project;
    expect(mediaUsage(p, 'clip')).toBe(1);
    const after = removeMedia(p, 'clip');
    expect(after.surfaces[0].layers.map((l) => l.mediaId)).toEqual([TESTCARD_ID, TESTCARD_ID]);
  });

  it('forgets a selected layer that no longer exists', () => {
    const { store, id, top } = withLayers();
    store.getState().select({ surfaceId: id, layerId: top.id });
    store.getState().undo(); // removes the added layer
    expect(store.getState().selection.layerId).toBeNull();
  });
});

describe('media surfaces', () => {
  const capture = { id: 'cap', kind: 'capture' as const, name: '창 1', width: 1600, height: 1000, loop: true };

  it('names the surface after the media and keeps its aspect', () => {
    const p = createProject();
    const s = createMediaSurface(p, capture);
    const [tl, , br] = s.output;
    expect(s.name).toBe('창 1');
    expect(s.layers.map((l) => l.mediaId)).toEqual(['cap']);
    expect((br.x - tl.x) / (br.y - tl.y)).toBeCloseTo(1.6);
  });

  it('steps new surfaces apart and keeps them on the output', () => {
    let p = createProject();
    const corners: number[] = [];
    const middle = createSurface(p, capture).output[0].x;
    for (let i = 0; i < 6; i++) {
      const s = createMediaSurface(p, capture);
      corners.push(s.output[0].x);
      for (const q of s.output) {
        expect(q.x).toBeGreaterThanOrEqual(0);
        expect(q.x).toBeLessThanOrEqual(p.output.width);
        expect(q.y).toBeGreaterThanOrEqual(0);
        expect(q.y).toBeLessThanOrEqual(p.output.height);
      }
      p = { ...p, surfaces: [...p.surfaces, s] };
    }
    expect(new Set(corners).size).toBe(6);
    expect(corners).not.toContain(middle);
  });

  it('centers on a drop point, clamped to the output', () => {
    const p = createProject();
    const s = createMediaSurface(p, capture, { x: 1900, y: 20 });
    const [tl, , br] = s.output;
    expect(br.x).toBeCloseTo(1920);
    expect(tl.y).toBeCloseTo(0);
  });
});
