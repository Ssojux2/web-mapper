import { describe, expect, it } from 'vitest';
import { createMesh, createProject, createSurface, updateSurface } from './model';
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
