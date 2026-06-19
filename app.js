const INCH_TO_MM = 25.4;
const state = {
  theme: "light",
  unit: "in",
  materials: [],
  selectedMaterialIndex: 0,
  thicknessIn: 0.063,
  kFactor: 0.42,
  bendRadiusIn: 0.035,
  dimensionOffsets: {},
  flanges: [
    { lengthIn: 2, lengthType: "outside", angle: 90, direction: "up" },
    { lengthIn: 3, lengthType: "bendLine", angle: 90, direction: "down" },
    { lengthIn: 1.5, lengthType: "outside", angle: 0, direction: "up" }
  ]
};

const els = {
  materialSelect: document.querySelector("#materialSelect"),
  thickness: document.querySelector("#thickness"),
  kFactor: document.querySelector("#kFactor"),
  bendRadius: document.querySelector("#bendRadius"),
  addFlange: document.querySelector("#addFlange"),
  flangeRows: document.querySelector("#flangeRows"),
  totalFlat: document.querySelector("#totalFlat"),
  bendCount: document.querySelector("#bendCount"),
  crossSection: document.querySelector("#crossSection"),
  flatView: document.querySelector("#flatView"),
  bendTable: document.querySelector("#bendTable"),
  crossScale: document.querySelector("#crossScale"),
  themeToggle: document.querySelector("#themeToggle"),
  exportPdf: document.querySelector("#exportPdf"),
  fitButtons: document.querySelectorAll("[data-fit-view]")
};

const viewports = {
  cross: {
    svg: document.querySelector("#crossSection"),
    base: { x: 0, y: 0, width: 900, height: 330 },
    view: { x: 0, y: 0, width: 900, height: 330 },
    userAdjusted: false
  },
  flat: {
    svg: document.querySelector("#flatView"),
    base: { x: 0, y: 0, width: 900, height: 330 },
    view: { x: 0, y: 0, width: 900, height: 330 },
    userAdjusted: false
  }
};

const format = (value, decimals = 3) => {
  const unitValue = state.unit === "mm" ? value * INCH_TO_MM : value;
  return `${unitValue.toFixed(decimals)} ${state.unit}`;
};

const parseUnitValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return state.unit === "mm" ? parsed / INCH_TO_MM : parsed;
};

const toDisplayValue = (inches) => {
  const value = state.unit === "mm" ? inches * INCH_TO_MM : inches;
  return Number(value.toFixed(state.unit === "mm" ? 2 : 4));
};

const activeBends = () => state.flanges.slice(0, -1).filter((flange) => flange.angle > 0);

function initialTheme() {
  const saved = localStorage.getItem("bendCalculatorTheme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("bendCalculatorTheme", theme);
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function bendMath(angleDeg) {
  const t = state.thicknessIn;
  const r = state.bendRadiusIn;
  const k = state.kFactor;
  const angle = Math.max(0, Math.min(179.9, Number(angleDeg) || 0));
  const radians = angle * Math.PI / 180;
  const ba = Math.PI * (r + k * t) * angle / 180;
  const outsideSetback = (r + t) * Math.tan(radians / 2);
  const insideSetback = r * Math.tan(radians / 2);
  const neutralSetback = (r + k * t) * Math.tan(radians / 2);
  const deduction = 2 * outsideSetback - ba;
  return { angle, ba, outsideSetback, insideSetback, neutralSetback, deduction };
}

function adjacentOffsets(index) {
  const prev = index > 0 ? bendMath(state.flanges[index - 1].angle) : null;
  const next = index < state.flanges.length - 1 ? bendMath(state.flanges[index].angle) : null;
  return {
    inside: (prev?.insideSetback || 0) + (next?.insideSetback || 0),
    outside: (prev?.outsideSetback || 0) + (next?.outsideSetback || 0),
    neutral: (prev?.neutralSetback || 0) + (next?.neutralSetback || 0)
  };
}

function bendDirectionSign(incoming, outgoing) {
  return cross(incoming, outgoing) >= 0 ? 1 : -1;
}

function flangeDirections() {
  let heading = 0;
  return state.flanges.map((flange, index) => {
    const direction = point(Math.cos(heading), -Math.sin(heading));
    if (index < state.flanges.length - 1) {
      const turn = Math.PI - flange.angle * Math.PI / 180;
      heading += (flange.direction === "up" ? 1 : -1) * turn;
    }
    return direction;
  });
}

function bendLineFaceDelta(index, directions) {
  const currentDirection = directions[index];
  const halfThickness = state.thicknessIn / 2;
  const previousDirection = directions[index - 1];
  const nextDirection = directions[index + 1];
  const previousSide = previousDirection ? bendDirectionSign(previousDirection, currentDirection) : null;
  const nextSide = nextDirection ? bendDirectionSign(currentDirection, nextDirection) : null;

  const endpointDelta = (side, adjacentDirection) => {
    if (!adjacentDirection) return 0;
    const currentFacePoint = mul(perpLeft(currentDirection), side * halfThickness);
    const adjacentFacePoint = mul(perpLeft(adjacentDirection), side * halfThickness);
    const intersection = lineIntersection(currentFacePoint, currentDirection, adjacentFacePoint, adjacentDirection);
    return intersection ? dot(intersection, currentDirection) : 0;
  };

  const startDelta = endpointDelta(previousSide, previousDirection);
  const endDelta = endpointDelta(nextSide, nextDirection);
  return endDelta - startDelta;
}

function flangeDims(flange, index, directions) {
  const offsets = adjacentOffsets(index);
  const faceDelta = bendLineFaceDelta(index, directions);
  let apexLength = Math.max(0.01, flange.lengthIn - faceDelta);
  if (flange.lengthType === "inside") apexLength = flange.lengthIn + offsets.inside;
  if (flange.lengthType === "outside") apexLength = Math.max(0.01, flange.lengthIn - offsets.outside);
  const bendLine = Math.max(0, apexLength + faceDelta);

  return {
    bendLine,
    inside: Math.max(0, apexLength - offsets.inside),
    outside: apexLength + offsets.outside,
    neutral: apexLength,
    offsets
  };
}

function calculateModel() {
  const directions = flangeDirections();
  const flangeData = state.flanges.map((flange, index) => flangeDims(flange, index, directions));
  const bends = state.flanges.slice(0, -1).map((flange, index) => ({
    ...bendMath(flange.angle),
    direction: flange.direction,
    index
  }));
  const flatLength = flangeData.reduce((sum, flange) => sum + flange.neutral, 0) +
    bends.reduce((sum, bend) => sum + bend.ba, 0);
  return { flangeData, bends, flatLength };
}

function populateMaterials() {
  const options = state.materials.map((row, index) => {
    const label = `${row.material} - ${row.thickness.toFixed(3)} in`;
    return `<option value="${index}">${label}</option>`;
  });
  els.materialSelect.innerHTML = options.join("");
}

function applyMaterial(index) {
  const material = state.materials[index];
  if (!material) return;
  state.selectedMaterialIndex = index;
  state.thicknessIn = material.thickness;
  state.kFactor = material.kFactor;
  state.bendRadiusIn = material.effectiveBendRadius90;
}

function renderInputs() {
  document.querySelectorAll(".segmented").forEach((button) => {
    button.classList.toggle("active", button.dataset.unit === state.unit);
  });
  els.materialSelect.value = String(state.selectedMaterialIndex);
  els.thickness.value = toDisplayValue(state.thicknessIn);
  els.kFactor.value = state.kFactor;
  els.bendRadius.value = toDisplayValue(state.bendRadiusIn);
}

function renderFlanges() {
  els.flangeRows.innerHTML = state.flanges.map((flange, index) => {
    const isLast = index === state.flanges.length - 1;
    return `
      <article class="flange-row" data-index="${index}">
        <div class="flange-head">
          <strong>Flange ${index + 1}</strong>
          ${state.flanges.length > 2 ? `<button class="icon-button remove" data-action="remove" title="Remove flange" aria-label="Remove flange">-</button>` : ""}
        </div>
        <div class="flange-grid">
          <label>
            Length
            <input data-field="lengthIn" type="number" min="0.01" step="${state.unit === "mm" ? "0.1" : "0.001"}" value="${toDisplayValue(flange.lengthIn)}">
          </label>
          <label>
            Length type
            <select data-field="lengthType">
              <option value="bendLine" ${flange.lengthType === "bendLine" ? "selected" : ""}>To bend line</option>
              <option value="inside" ${flange.lengthType === "inside" ? "selected" : ""}>Inside length</option>
              <option value="outside" ${flange.lengthType === "outside" ? "selected" : ""}>Outside length</option>
            </select>
          </label>
        </div>
        <div class="bend-grid">
          <label>
            Bend angle after
            <input data-field="angle" type="number" min="0" max="179" step="1" value="${isLast ? 0 : flange.angle}" ${isLast ? "disabled" : ""}>
          </label>
          <label>
            Direction
            <select data-field="direction" ${isLast ? "disabled" : ""}>
              <option value="up" ${flange.direction === "up" ? "selected" : ""}>Up</option>
              <option value="down" ${flange.direction === "down" ? "selected" : ""}>Down</option>
            </select>
          </label>
        </div>
      </article>
    `;
  }).join("");
}

function svg(tag, attrs = {}, content = "") {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(" ");
  return `<${tag} ${attrText}>${content}</${tag}>`;
}

function viewForElement(svgElement) {
  return svgElement === els.crossSection ? "cross" : "flat";
}

function applyViewport(key) {
  const viewport = viewports[key];
  const { x, y, width, height } = viewport.view;
  viewport.svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function fittedView(key) {
  const viewport = viewports[key];
  const base = viewport.base;
  const svgWidth = viewport.svg.clientWidth || base.width;
  const svgHeight = viewport.svg.clientHeight || base.height;
  const svgRatio = svgWidth / svgHeight;
  const baseRatio = base.width / base.height;
  const view = { ...base };

  if (svgRatio > baseRatio) {
    view.width = base.height * svgRatio;
    view.x = base.x - (view.width - base.width) / 2;
  } else {
    view.height = base.width / svgRatio;
    view.y = base.y - (view.height - base.height) / 2;
  }

  return view;
}

function fitViewport(key) {
  viewports[key].view = fittedView(key);
  viewports[key].userAdjusted = false;
  applyViewport(key);
}

function setViewportBase(key, width, height) {
  const viewport = viewports[key];
  viewport.base = { x: 0, y: 0, width, height };
  if (!viewport.userAdjusted) {
    viewport.view = fittedView(key);
  }
  applyViewport(key);
}

function svgPointFromEvent(svgElement, event, view) {
  const rect = svgElement.getBoundingClientRect();
  return {
    x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
    y: view.y + ((event.clientY - rect.top) / rect.height) * view.height
  };
}

function zoomViewport(svgElement, event) {
  event.preventDefault();
  const key = viewForElement(svgElement);
  const viewport = viewports[key];
  const current = viewport.view;
  const zoomFactor = event.deltaY < 0 ? 0.86 : 1.16;
  const minWidth = viewport.base.width / 24;
  const maxWidth = viewport.base.width * 10;
  const nextWidth = Math.max(minWidth, Math.min(maxWidth, current.width * zoomFactor));
  const nextHeight = nextWidth * (current.height / current.width);
  const point = svgPointFromEvent(svgElement, event, current);
  const rect = svgElement.getBoundingClientRect();
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;

  viewport.view = {
    x: point.x - ratioX * nextWidth,
    y: point.y - ratioY * nextHeight,
    width: nextWidth,
    height: nextHeight
  };
  viewport.userAdjusted = true;
  applyViewport(key);
}

function panViewport(svgElement) {
  let drag = null;

  svgElement.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-dimension-type]")) return;
    if (event.button !== 0) return;
    const key = viewForElement(svgElement);
    const viewport = viewports[key];
    drag = {
      key,
      startX: event.clientX,
      startY: event.clientY,
      view: { ...viewport.view }
    };
    svgElement.classList.add("is-panning");
    svgElement.setPointerCapture(event.pointerId);
  });

  svgElement.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const viewport = viewports[drag.key];
    const rect = svgElement.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / rect.width) * drag.view.width;
    const dy = ((event.clientY - drag.startY) / rect.height) * drag.view.height;
    viewport.view = {
      ...drag.view,
      x: drag.view.x - dx,
      y: drag.view.y - dy
    };
    viewport.userAdjusted = true;
    applyViewport(drag.key);
  });

  const finishPan = (event) => {
    if (!drag) return;
    svgElement.classList.remove("is-panning");
    if (svgElement.hasPointerCapture(event.pointerId)) {
      svgElement.releasePointerCapture(event.pointerId);
    }
    drag = null;
  };

  svgElement.addEventListener("pointerup", finishPan);
  svgElement.addEventListener("pointercancel", finishPan);
  svgElement.addEventListener("pointerleave", finishPan);
}

function bindDimensionDragging() {
  let drag = null;

  els.crossSection.addEventListener("pointerdown", (event) => {
    const dimension = event.target.closest("[data-dimension-type]");
    if (!dimension) return;
    event.preventDefault();
    event.stopPropagation();
    const key = dimension.dataset.dimensionKey;
    const normal = point(Number(dimension.dataset.normalX), Number(dimension.dataset.normalY));
    const startPoint = svgPointFromEvent(els.crossSection, event, viewports.cross.view);
    drag = {
      key,
      normal,
      startPoint,
      startOffset: state.dimensionOffsets[key] ?? Number(dimension.dataset.defaultOffset)
    };
    els.crossSection.classList.add("is-dragging-dimension");
  });

  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const currentPoint = svgPointFromEvent(els.crossSection, event, viewports.cross.view);
    const delta = dot(sub(currentPoint, drag.startPoint), drag.normal);
    state.dimensionOffsets[drag.key] = drag.startOffset + delta;
    renderCalculated();
  });

  window.addEventListener("pointerup", () => {
    if (!drag) return;
    els.crossSection.classList.remove("is-dragging-dimension");
    drag = null;
  });
}

const drawing = {
  scale: 120,
  minThicknessPx: 12
};

const point = (x, y) => ({ x, y });
const add = (a, b) => point(a.x + b.x, a.y + b.y);
const sub = (a, b) => point(a.x - b.x, a.y - b.y);
const mul = (a, value) => point(a.x * value, a.y * value);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => {
  const length = len(a) || 1;
  return point(a.x / length, a.y / length);
};
const perpLeft = (a) => point(-a.y, a.x);

function pathFromPoints(points) {
  return points.map((p, index) => `${index ? "L" : "M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

function pathWithRoundedBends(vertices, bends, radiusPx) {
  if (vertices.length < 2) return { d: "", flangeSegments: [], bendData: [] };

  const flangeSegments = [];
  const bendData = [];
  let d = `M ${vertices[0].x.toFixed(2)} ${vertices[0].y.toFixed(2)}`;
  let previousTangent = vertices[0];

  for (let index = 0; index < bends.length; index += 1) {
    const vertex = vertices[index + 1];
    const incoming = norm(sub(vertex, vertices[index]));
    const outgoing = norm(sub(vertices[index + 2], vertex));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))));
    const maxTangent = Math.min(len(sub(vertex, previousTangent)) * 0.45, len(sub(vertices[index + 2], vertex)) * 0.45);
    const requestedTangent = radiusPx * Math.tan(phi / 2);
    const tangent = Math.max(0, Math.min(requestedTangent, maxTangent));
    const radius = tangent < requestedTangent && Math.tan(phi / 2) > 0 ? tangent / Math.tan(phi / 2) : radiusPx;
    const tangentIn = sub(vertex, mul(incoming, tangent));
    const tangentOut = add(vertex, mul(outgoing, tangent));
    const sweep = cross(incoming, outgoing) > 0 ? 1 : 0;
    const directionSign = cross(incoming, outgoing) >= 0 ? 1 : -1;
    const center = add(tangentIn, mul(perpLeft(incoming), directionSign * radius));

    flangeSegments.push({ start: previousTangent, end: tangentIn, vertexStart: vertices[index], vertexEnd: vertex });
    d += ` L ${tangentIn.x.toFixed(2)} ${tangentIn.y.toFixed(2)}`;
    d += ` A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${sweep} ${tangentOut.x.toFixed(2)} ${tangentOut.y.toFixed(2)}`;
    bendData.push({
      index,
      vertex,
      tangentIn,
      tangentOut,
      incoming,
      outgoing,
      center,
      radius,
      sweep,
      phi,
      directionSign,
      bend: bends[index]
    });
    previousTangent = tangentOut;
  }

  flangeSegments.push({
    start: previousTangent,
    end: vertices[vertices.length - 1],
    vertexStart: vertices[vertices.length - 2],
    vertexEnd: vertices[vertices.length - 1]
  });
  d += ` L ${vertices[vertices.length - 1].x.toFixed(2)} ${vertices[vertices.length - 1].y.toFixed(2)}`;

  return { d, flangeSegments, bendData };
}

function buildCrossSectionGeometry(model) {
  const scale = drawing.scale;
  const vertices = [point(80, 190)];
  let heading = 0;
  let cursor = vertices[0];

  model.flangeData.forEach((flange, index) => {
    cursor = add(cursor, point(Math.cos(heading) * flange.neutral * scale, -Math.sin(heading) * flange.neutral * scale));
    vertices.push(cursor);
    const bend = model.bends[index];
    if (bend) {
      const turn = Math.PI - bend.angle * Math.PI / 180;
      heading += (bend.direction === "up" ? 1 : -1) * turn;
    }
  });

  const centerRadiusPx = Math.max(8, (state.bendRadiusIn + state.thicknessIn / 2) * scale);
  return {
    vertices,
    centerRadiusPx,
    ...pathWithRoundedBends(vertices, model.bends, centerRadiusPx)
  };
}

function boundsForSvg(items, padding = 120) {
  const xs = [];
  const ys = [];
  const collect = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    xs.push(value.x);
    ys.push(value.y);
  };
  collect(items);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2)
  };
}

function setViewportBounds(key, bounds) {
  const viewport = viewports[key];
  viewport.base = bounds;
  if (!viewport.userAdjusted) {
    viewport.view = fittedView(key);
  }
  applyViewport(key);
}

function defaultDimensionOffset(type, fallback) {
  if (Number.isFinite(fallback)) return fallback;
  if (type === "inside") return 24;
  if (type === "outside") return 92;
  return 58;
}

function dimensionKey(type, index) {
  return `${type}-${index}`;
}

function getDimensionOffset(key, type, fallback) {
  return state.dimensionOffsets[key] ?? defaultDimensionOffset(type, fallback);
}

function arrowHead(tip, direction, size = 13, spread = 7) {
  const unit = norm(direction);
  const normal = perpLeft(unit);
  const base = sub(tip, mul(unit, size));
  const a = add(base, mul(normal, spread));
  const b = sub(base, mul(normal, spread));
  return `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${a.x.toFixed(2)},${a.y.toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

function dimensionLine(label, start, end, className, type, index, defaultOffset, axisDirection = null) {
  const direction = norm(axisDirection ?? sub(end, start));
  const normal = perpLeft(direction);
  const key = dimensionKey(type, index);
  const offset = getDimensionOffset(key, type, defaultOffset);
  const startProjection = dot(start, direction);
  const endProjection = dot(end, direction);
  const normalProjection = (dot(start, normal) + dot(end, normal)) / 2;
  const dimStart = add(mul(direction, startProjection), mul(normal, normalProjection + offset));
  const dimEnd = add(mul(direction, endProjection), mul(normal, normalProjection + offset));
  const mid = mul(add(dimStart, dimEnd), 0.5);
  const angle = Math.atan2(dimEnd.y - dimStart.y, dimEnd.x - dimStart.x) * 180 / Math.PI;
  const textAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
  const extensionOffset = offset + (offset >= 0 ? 10 : -10);
  const extA = add(mul(direction, startProjection), mul(normal, normalProjection + extensionOffset));
  const extB = add(mul(direction, endProjection), mul(normal, normalProjection + extensionOffset));

  return svg("g", {
    class: `dimension ${className}`,
    "data-dimension-type": type,
    "data-dimension-key": key,
    "data-dimension-index": index,
    "data-default-offset": offset.toFixed(6),
    "data-normal-x": normal.x.toFixed(6),
    "data-normal-y": normal.y.toFixed(6)
  }, [
    svg("line", { class: "extension-line", x1: start.x, y1: start.y, x2: extA.x, y2: extA.y }),
    svg("line", { class: "extension-line", x1: end.x, y1: end.y, x2: extB.x, y2: extB.y }),
    svg("line", { class: "dimension-line", x1: dimStart.x, y1: dimStart.y, x2: dimEnd.x, y2: dimEnd.y }),
    svg("polygon", { class: "dimension-arrow", points: arrowHead(dimStart, sub(dimStart, dimEnd)) }),
    svg("polygon", { class: "dimension-arrow", points: arrowHead(dimEnd, sub(dimEnd, dimStart)) }),
    svg("circle", { class: "dimension-grip", cx: mid.x, cy: mid.y, r: 7 }),
    svg("text", { class: "dimension-label", x: mid.x, y: mid.y - 8, transform: `rotate(${textAngle.toFixed(2)} ${mid.x.toFixed(2)} ${mid.y.toFixed(2)})`, "text-anchor": "middle" }, label)
  ].join(""));
}

function bendAngleAnnotation(bendData) {
  const radius = Math.max(44, bendData.radius * 2.8);
  const start = add(bendData.vertex, mul(bendData.incoming, -radius));
  const end = add(bendData.vertex, mul(bendData.outgoing, radius));
  const sweep = bendData.directionSign > 0 ? 1 : 0;
  const midVector = norm(add(mul(bendData.incoming, -1), bendData.outgoing));
  const labelPoint = add(bendData.vertex, mul(midVector, radius + 28));

  return svg("g", { class: "angle-annotation" }, [
    svg("path", { class: "angle-arc", d: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`, "marker-end": "url(#arrow)" }),
    svg("text", { class: "angle-label", x: labelPoint.x, y: labelPoint.y, "text-anchor": "middle" }, `${bendData.bend.angle.toFixed(1)} deg`)
  ].join(""));
}

function crossSectionDefs() {
  return svg("defs", {}, [
    svg("marker", { id: "arrow", markerWidth: 8, markerHeight: 8, refX: 4, refY: 4, orient: "auto", markerUnits: "strokeWidth" },
      svg("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: "var(--cad-line)" }))
  ].join(""));
}

function offsetPointForDirection(base, direction, side, halfThickness) {
  return add(base, mul(perpLeft(direction), side * halfThickness));
}

function flangeMaterialPath(segment, halfThickness) {
  const direction = norm(sub(segment.end, segment.start));
  const leftStart = offsetPointForDirection(segment.start, direction, 1, halfThickness);
  const leftEnd = offsetPointForDirection(segment.end, direction, 1, halfThickness);
  const rightEnd = offsetPointForDirection(segment.end, direction, -1, halfThickness);
  const rightStart = offsetPointForDirection(segment.start, direction, -1, halfThickness);
  return `M ${leftStart.x.toFixed(2)} ${leftStart.y.toFixed(2)} L ${leftEnd.x.toFixed(2)} ${leftEnd.y.toFixed(2)} L ${rightEnd.x.toFixed(2)} ${rightEnd.y.toFixed(2)} L ${rightStart.x.toFixed(2)} ${rightStart.y.toFixed(2)} Z`;
}

function bendMaterialPath(bend, halfThickness) {
  const startVector = norm(sub(bend.tangentIn, bend.center));
  const endVector = norm(sub(bend.tangentOut, bend.center));
  const outerRadius = Math.max(1, bend.radius + halfThickness);
  const innerRadius = Math.max(1, bend.radius - halfThickness);
  const outerStart = add(bend.center, mul(startVector, outerRadius));
  const outerEnd = add(bend.center, mul(endVector, outerRadius));
  const innerEnd = add(bend.center, mul(endVector, innerRadius));
  const innerStart = add(bend.center, mul(startVector, innerRadius));

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 0 ${bend.sweep} ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 0 ${bend.sweep ? 0 : 1} ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z"
  ].join(" ");
}

function sampleArcPoints(center, startVector, endVector, radius, sweep, steps = 8) {
  const points = [];
  const startAngle = Math.atan2(startVector.y, startVector.x);
  const endAngle = Math.atan2(endVector.y, endVector.x);
  let delta = endAngle - startAngle;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;

  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + delta * (step / steps);
    points.push(add(center, point(Math.cos(angle) * radius, Math.sin(angle) * radius)));
  }
  return points;
}

function bendArcMidVector(bend) {
  const startVector = norm(sub(bend.tangentIn, bend.center));
  const endVector = norm(sub(bend.tangentOut, bend.center));
  const startAngle = Math.atan2(startVector.y, startVector.x);
  const endAngle = Math.atan2(endVector.y, endVector.x);
  let delta = endAngle - startAngle;
  if (bend.sweep && delta < 0) delta += Math.PI * 2;
  if (!bend.sweep && delta > 0) delta -= Math.PI * 2;
  const midAngle = startAngle + delta / 2;
  return point(Math.cos(midAngle), Math.sin(midAngle));
}

function bendLineMarker(bend, index, halfThickness) {
  const midVector = bendArcMidVector(bend);
  const innerRadius = Math.max(1, bend.radius - halfThickness);
  const outerRadius = Math.max(1, bend.radius + halfThickness);
  const innerPoint = add(bend.center, mul(midVector, innerRadius));
  const outerPoint = add(bend.center, mul(midVector, outerRadius));
  const markPoint = add(bend.center, mul(midVector, bend.radius));
  const labelPoint = add(markPoint, mul(midVector, 22));

  return svg("g", { class: "bend-mark-group" }, [
    svg("line", { class: "bend-line-marker", x1: innerPoint.x, y1: innerPoint.y, x2: outerPoint.x, y2: outerPoint.y }),
    svg("circle", { class: "bend-mark", cx: markPoint.x, cy: markPoint.y, r: 5 }),
    svg("text", { class: "svg-small", x: labelPoint.x, y: labelPoint.y, "text-anchor": "middle" }, `B${index + 1}`)
  ].join(""));
}

function bendLineMarkPoint(bend) {
  return add(bend.center, mul(bendArcMidVector(bend), bend.radius));
}

function materialCandidatePoints(segment, bend, halfThickness) {
  if (segment) {
    const direction = norm(sub(segment.end, segment.start));
    return [
      tangentDimensionPoint(segment.start, direction, 1, halfThickness),
      tangentDimensionPoint(segment.end, direction, 1, halfThickness),
      tangentDimensionPoint(segment.start, direction, -1, halfThickness),
      tangentDimensionPoint(segment.end, direction, -1, halfThickness)
    ];
  }

  if (bend) {
    const startVector = norm(sub(bend.tangentIn, bend.center));
    const endVector = norm(sub(bend.tangentOut, bend.center));
    return [
      ...sampleArcPoints(bend.center, startVector, endVector, Math.max(1, bend.radius + halfThickness), bend.sweep),
      ...sampleArcPoints(bend.center, startVector, endVector, Math.max(1, bend.radius - halfThickness), bend.sweep)
    ];
  }

  return [];
}

function faceEnvelopeEndpoints(index, geometry, halfThickness, faceSide) {
  const segment = geometry.flangeSegments[index];
  const direction = norm(sub(segment.vertexEnd, segment.vertexStart));
  const normal = perpLeft(direction);
  const face = tangentDimensionPoint(segment.start, direction, faceSide, halfThickness);
  const faceNormalProjection = dot(face, normal);
  const candidates = [
    ...materialCandidatePoints(segment, null, halfThickness),
    ...materialCandidatePoints(null, geometry.bendData[index - 1], halfThickness),
    ...materialCandidatePoints(null, geometry.bendData[index], halfThickness)
  ];

  const envelope = candidates.reduce((result, candidate) => {
    const projection = dot(candidate, direction);
    if (projection < result.min) {
      result.min = projection;
    }
    if (projection > result.max) {
      result.max = projection;
    }
    return result;
  }, { min: Infinity, max: -Infinity });

  if (!Number.isFinite(envelope.min) || !Number.isFinite(envelope.max)) {
    return { start: null, end: null };
  }

  return {
    start: add(mul(direction, envelope.min), mul(normal, faceNormalProjection)),
    end: add(mul(direction, envelope.max), mul(normal, faceNormalProjection))
  };
}

function outsideEnvelopeEndpoints(index, geometry, halfThickness) {
  const insideSide = flangeInsideSide(index, geometry);
  return faceEnvelopeEndpoints(index, geometry, halfThickness, -insideSide);
}

function insideEnvelopeEndpoints(index, geometry, halfThickness) {
  const insideSide = flangeInsideSide(index, geometry);
  return faceEnvelopeEndpoints(index, geometry, halfThickness, insideSide);
}

function lineIntersection(pointA, directionA, pointB, directionB) {
  const denominator = cross(directionA, directionB);
  if (Math.abs(denominator) < 0.000001) return null;
  const t = cross(sub(pointB, pointA), directionB) / denominator;
  return add(pointA, mul(directionA, t));
}

function adjacentFaceIntersection(currentPoint, currentDirection, adjacentSegment, preferProjection, mode, halfThickness) {
  if (!adjacentSegment) return null;
  const adjacentDirection = norm(sub(adjacentSegment.vertexEnd, adjacentSegment.vertexStart));
  const candidates = [-1, 1]
    .map((side) => {
      const facePoint = tangentDimensionPoint(adjacentSegment.start, adjacentDirection, side, halfThickness);
      const intersection = lineIntersection(currentPoint, currentDirection, facePoint, adjacentDirection);
      if (!intersection) return null;
      return {
        point: intersection,
        projection: dot(intersection, currentDirection)
      };
    })
    .filter(Boolean);

  if (!candidates.length) return null;

  const inward = candidates.filter((candidate) => (
    mode === "start"
      ? candidate.projection >= preferProjection - 0.01
      : candidate.projection <= preferProjection + 0.01
  ));
  const pool = inward.length ? inward : candidates;

  return pool.reduce((best, candidate) => {
    const distance = Math.abs(candidate.projection - preferProjection);
    if (!best || distance < best.distance) {
      return { ...candidate, distance };
    }
    return best;
  }, null).point;
}

function insideAdjacentFaceEndpoints(index, geometry, halfThickness) {
  const segment = geometry.flangeSegments[index];
  const direction = norm(sub(segment.vertexEnd, segment.vertexStart));
  const insideSide = flangeInsideSide(index, geometry);
  const insideFacePoint = tangentDimensionPoint(segment.start, direction, insideSide, halfThickness);
  const currentStartProjection = dot(segment.start, direction);
  const currentEndProjection = dot(segment.end, direction);
  const previousSegment = geometry.flangeSegments[index - 1];
  const nextSegment = geometry.flangeSegments[index + 1];

  return {
    start: adjacentFaceIntersection(insideFacePoint, direction, previousSegment, currentStartProjection, "start", halfThickness),
    end: adjacentFaceIntersection(insideFacePoint, direction, nextSegment, currentEndProjection, "end", halfThickness)
  };
}

function renderMaterialPieces(geometry, halfThickness) {
  const flanges = geometry.flangeSegments
    .map((segment) => svg("path", { class: "sheet-body", d: flangeMaterialPath(segment, halfThickness) }))
    .join("");
  const bends = geometry.bendData
    .map((bend) => svg("path", { class: "sheet-body bend-body", d: bendMaterialPath(bend, halfThickness) }))
    .join("");
  return `${flanges}${bends}`;
}

function tangentDimensionPoint(base, direction, side, halfThickness) {
  return offsetPointForDirection(base, direction, side, halfThickness);
}

function flangeInsideSide(index, geometry) {
  const nextBend = geometry.bendData[index];
  const prevBend = geometry.bendData[index - 1];
  return nextBend?.directionSign ?? prevBend?.directionSign ?? 1;
}

function bendLineFaceEndpoints(index, geometry, halfThickness) {
  const segment = geometry.flangeSegments[index];
  const direction = norm(sub(segment.vertexEnd, segment.vertexStart));
  const fallbackSide = flangeInsideSide(index, geometry);
  const previousBend = geometry.bendData[index - 1];
  const nextBend = geometry.bendData[index];
  const bendReferencePoint = (bend, fallbackVertex) => {
    if (!bend) {
      return tangentDimensionPoint(fallbackVertex, direction, fallbackSide, halfThickness);
    }

    const markerPoint = bendLineMarkPoint(bend);
    const flangeNormal = perpLeft(direction);
    const flangeNormalProjection = dot(fallbackVertex, flangeNormal);
    return add(mul(direction, dot(markerPoint, direction)), mul(flangeNormal, flangeNormalProjection));
  };

  return {
    start: bendReferencePoint(previousBend, segment.vertexStart),
    end: bendReferencePoint(nextBend, segment.vertexEnd),
    side: fallbackSide
  };
}

function renderCadDimensions(model, geometry, halfThickness) {
  return geometry.flangeSegments.map((segment, index) => {
    const flange = model.flangeData[index];
    const direction = norm(sub(segment.vertexEnd, segment.vertexStart));
    const insideSide = flangeInsideSide(index, geometry);
    const outsideSide = -insideSide;
    const insideAdjacentFaces = insideAdjacentFaceEndpoints(index, geometry, halfThickness);
    const insideEnvelope = insideEnvelopeEndpoints(index, geometry, halfThickness);
    const insideStart = insideAdjacentFaces.start ?? insideEnvelope.start ?? tangentDimensionPoint(segment.start, direction, insideSide, halfThickness);
    const insideEnd = insideAdjacentFaces.end ?? insideEnvelope.end ?? tangentDimensionPoint(segment.end, direction, insideSide, halfThickness);
    const outsideEnvelope = outsideEnvelopeEndpoints(index, geometry, halfThickness);
    const outsideStart = outsideEnvelope.start ?? tangentDimensionPoint(segment.start, direction, outsideSide, halfThickness);
    const outsideEnd = outsideEnvelope.end ?? tangentDimensionPoint(segment.end, direction, outsideSide, halfThickness);
    const bendLineFace = bendLineFaceEndpoints(index, geometry, halfThickness);
    const insideOffset = insideSide * 34;
    const outsideOffset = outsideSide * 128;
    const bendLineOffset = bendLineFace.side * 64;
    const parts = [
      dimensionLine(`BL ${format(flange.bendLine)}`, bendLineFace.start, bendLineFace.end, "bendline-dimension", "bendLine", index, bendLineOffset, direction),
      dimensionLine(`IN ${format(flange.inside)}`, insideStart, insideEnd, "inside-dimension", "inside", index, insideOffset, direction),
      dimensionLine(`OUT ${format(flange.outside)}`, outsideStart, outsideEnd, "outside-dimension", "outside", index, outsideOffset, direction)
    ];
    return parts.join("");
  }).join("");
}

function renderCrossSection(model) {
  const geometry = buildCrossSectionGeometry(model);
  const halfThickness = Math.max(drawing.minThicknessPx, state.thicknessIn * drawing.scale) / 2;
  const material = renderMaterialPieces(geometry, halfThickness);
  const neutral = svg("path", { class: "neutral-path", d: geometry.d, "stroke-width": 2 });
  const bendMarks = geometry.bendData.map((bend, index) => bendLineMarker(bend, index, halfThickness)).join("");
  const angles = geometry.bendData.map(bendAngleAnnotation).join("");
  const dimensions = renderCadDimensions(model, geometry, halfThickness);
  const bounds = boundsForSvg([
    geometry.vertices,
    geometry.bendData.flatMap((bend) => [bend.center, bend.tangentIn, bend.tangentOut]),
    geometry.flangeSegments.flatMap((segment) => [segment.start, segment.end, segment.vertexStart, segment.vertexEnd])
  ], 320);

  els.crossSection.innerHTML = [
    crossSectionDefs(),
    material,
    neutral,
    dimensions,
    angles,
    bendMarks
  ].join("");
  setViewportBounds("cross", bounds);
  els.crossScale.textContent = "Drag dimensions";
}

function renderFlatView(model) {
  const width = 900;
  const height = 330;
  const pad = 48;
  const total = Math.max(model.flatLength, 0.1);
  const scale = (width - pad * 2) / total;
  const sheetY = 128;
  const sheetHeight = 86;
  let x = pad;
  const parts = [
    svg("rect", { x: pad, y: sheetY, width: total * scale, height: sheetHeight, rx: 4, fill: "#e7f0ed", stroke: "#176b87", "stroke-width": 2 }),
    svg("line", { class: "dim-line", x1: pad, y1: sheetY + sheetHeight + 34, x2: pad + total * scale, y2: sheetY + sheetHeight + 34 }),
    svg("text", { class: "svg-label", x: pad + total * scale / 2, y: sheetY + sheetHeight + 56, "text-anchor": "middle" }, `Flat length ${format(model.flatLength)}`)
  ];

  model.flangeData.forEach((flange, index) => {
    const start = x;
    x += flange.neutral * scale;
    parts.push(svg("text", { class: "svg-small", x: (start + x) / 2, y: sheetY - 14, "text-anchor": "middle" }, `F${index + 1} ${format(flange.bendLine)}`));
    const bend = model.bends[index];
    if (bend) {
      parts.push(svg("line", { class: "guide-line", x1: x, y1: sheetY - 16, x2: x, y2: sheetY + sheetHeight + 20 }));
      parts.push(svg("text", { class: "svg-label", x, y: sheetY + sheetHeight + 16, "text-anchor": "middle" }, `BL${index + 1}`));
      x += bend.ba * scale;
    }
  });

  els.flatView.innerHTML = parts.join("");
  setViewportBase("flat", width, height);
}

function renderBendTable(model) {
  if (!model.bends.length) {
    els.bendTable.innerHTML = `<tr><td colspan="6">Add at least two flanges with a bend angle to calculate bends.</td></tr>`;
    return;
  }

  els.bendTable.innerHTML = model.bends.map((bend, index) => `
    <tr>
      <td>B${index + 1}</td>
      <td>${bend.angle.toFixed(1)} deg</td>
      <td>${bend.direction}</td>
      <td>${format(bend.ba)}</td>
      <td>${format(bend.outsideSetback)}</td>
      <td>${format(bend.deduction)}</td>
    </tr>
  `).join("");
}

function cloneSvgForExport(sourceSvg) {
  const clone = sourceSvg.cloneNode(true);
  clone.removeAttribute("id");
  clone.removeAttribute("class");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "1600");
  clone.setAttribute("height", "1000");
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    :root { --cad-line: #18211f; }
    .sheet-body { fill: rgba(105, 112, 108, 0.56); stroke: #18211f; stroke-linejoin: round; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .bend-body { fill: rgba(105, 112, 108, 0.5); }
    .neutral-path { fill: none; opacity: 0.95; stroke: #27c2d6; stroke-linecap: round; }
    .dimension-line { fill: none; stroke: #18211f; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
    .dimension-arrow { fill: #18211f; stroke: none; }
    .extension-line { fill: none; stroke: rgba(24, 33, 31, 0.58); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .dimension-label, .angle-label { fill: #26302d; font-size: 12px; font-weight: 650; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; vector-effect: non-scaling-stroke; }
    .angle-arc { fill: none; stroke: #18211f; stroke-width: 1.35; vector-effect: non-scaling-stroke; }
    .dimension-grip { fill: rgba(39, 194, 214, 0.18); stroke: rgba(24, 33, 31, 0.5); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
    .inside-dimension .dimension-line { stroke: #176b87; }
    .outside-dimension .dimension-line { stroke: #8f4b29; }
    .bendline-dimension .dimension-line { stroke: #18211f; }
    .dim-line { stroke: #18211f; stroke-width: 1.2; }
    .guide-line { stroke: #9eaaa6; stroke-dasharray: 4 5; stroke-width: 1; }
    .bend-line-marker { stroke: #c7693d; stroke-width: 2; vector-effect: non-scaling-stroke; }
    .bend-mark { fill: #c7693d; stroke: white; stroke-width: 2; vector-effect: non-scaling-stroke; }
    .svg-label { fill: #18211f; font-size: 12px; font-weight: 700; }
    .svg-small { fill: #5f6d68; font-size: 11px; }
  `;
  clone.insertBefore(style, clone.firstChild);
  return clone.outerHTML;
}

function svgToJpegDataUrl(sourceSvg) {
  const svgText = cloneSvgForExport(sourceSvg);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1000;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to render SVG for PDF export."));
    };
    image.src = url;
  });
}

function dataUrlToBinary(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  return atob(base64);
}

function pdfEscape(text) {
  return String(text).replace(/[\\()]/g, "\\$&");
}

function buildPdfDocument(pages) {
  const objects = ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const pageRefs = [];
  const fontRef = 1;

  pages.forEach((page) => {
    const imageRef = addObject(`<< /Type /XObject /Subtype /Image /Width ${page.imageWidth} /Height ${page.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.imageData.length} >>\nstream\n${page.imageData}\nendstream`);
    const content = [
      "q",
      "0.94 0.97 0.96 rg",
      "0 0 792 612 re f",
      "Q",
      "BT /F1 18 Tf 42 568 Td (" + pdfEscape(page.title) + ") Tj ET",
      "BT /F1 9 Tf 42 550 Td (" + pdfEscape(page.subtitle) + ") Tj ET",
      "q",
      `${page.drawWidth.toFixed(2)} 0 0 ${page.drawHeight.toFixed(2)} ${page.drawX.toFixed(2)} ${page.drawY.toFixed(2)} cm`,
      `/Im${imageRef} Do`,
      "Q"
    ].join("\n");
    const contentRef = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageRef = addObject(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 1 0 R >> /XObject << /Im${imageRef} ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
    pageRefs.push(pageRef);
  });

  const pagesRef = addObject(`<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);
  const catalogRef = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);

  const patchedObjects = objects.map((body) => body.replaceAll("PAGES_REF", String(pagesRef)).replaceAll("/F1 1 0 R", `/F1 ${fontRef} 0 R`));
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  patchedObjects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${patchedObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${patchedObjects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

async function exportViewsToPdf() {
  const material = state.materials[state.selectedMaterialIndex];
  const materialLabel = material ? `${material.material} - ${format(material.thickness)}` : "Manual material";
  const generatedAt = new Date().toLocaleString();
  els.exportPdf.disabled = true;
  els.exportPdf.textContent = "Exporting...";

  try {
    const [crossImage, flatImage] = await Promise.all([
      svgToJpegDataUrl(els.crossSection),
      svgToJpegDataUrl(els.flatView)
    ]);
    const pageMeta = `${materialLabel} | Total flat: ${els.totalFlat.textContent} | Generated: ${generatedAt}`;
    const pages = [
      { title: "Cross Section", subtitle: pageMeta, imageData: dataUrlToBinary(crossImage), imageWidth: 1600, imageHeight: 1000 },
      { title: "Flat View", subtitle: pageMeta, imageData: dataUrlToBinary(flatImage), imageWidth: 1600, imageHeight: 1000 }
    ].map((page) => {
      const maxWidth = 708;
      const maxHeight = 470;
      const scale = Math.min(maxWidth / page.imageWidth, maxHeight / page.imageHeight);
      const drawWidth = page.imageWidth * scale;
      const drawHeight = page.imageHeight * scale;
      return {
        ...page,
        drawWidth,
        drawHeight,
        drawX: (792 - drawWidth) / 2,
        drawY: 46
      };
    });
    const pdf = buildPdfDocument(pages);
    downloadBlob(new Blob([binaryStringToBytes(pdf)], { type: "application/pdf" }), "sheet-metal-bend-views.pdf");
  } catch (error) {
    alert("PDF export failed. Try fitting both views, then export again.");
  } finally {
    els.exportPdf.disabled = false;
    els.exportPdf.textContent = "Export PDF";
  }
}

function renderCalculated() {
  const model = calculateModel();
  renderCrossSection(model);
  renderFlatView(model);
  renderBendTable(model);
  els.totalFlat.textContent = format(model.flatLength);
  els.bendCount.textContent = String(model.bends.length);
}

function render() {
  renderInputs();
  renderFlanges();
  renderCalculated();
}

function bindEvents() {
  els.themeToggle.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  els.exportPdf.addEventListener("click", exportViewsToPdf);

  document.querySelectorAll(".segmented").forEach((button) => {
    button.addEventListener("click", () => {
      state.unit = button.dataset.unit;
      render();
    });
  });

  els.materialSelect.addEventListener("change", (event) => {
    applyMaterial(Number(event.target.value));
    render();
  });

  els.thickness.addEventListener("input", (event) => {
    state.thicknessIn = Math.max(0.001, parseUnitValue(event.target.value));
    renderCalculated();
  });

  els.kFactor.addEventListener("input", (event) => {
    state.kFactor = Math.max(0, Math.min(1, Number(event.target.value) || 0));
    renderCalculated();
  });

  els.bendRadius.addEventListener("input", (event) => {
    state.bendRadiusIn = Math.max(0, parseUnitValue(event.target.value));
    renderCalculated();
  });

  els.addFlange.addEventListener("click", () => {
    const last = state.flanges[state.flanges.length - 1];
    last.angle = 90;
    state.flanges.push({ lengthIn: 1, lengthType: "outside", angle: 0, direction: "up" });
    render();
  });

  els.flangeRows.addEventListener("input", handleFlangeEvent);
  els.flangeRows.addEventListener("change", handleFlangeEvent);
  els.flangeRows.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-action='remove']");
    if (!removeButton) return;
    const row = event.target.closest(".flange-row");
    state.flanges.splice(Number(row.dataset.index), 1);
    state.flanges[state.flanges.length - 1].angle = 0;
    render();
  });

  els.fitButtons.forEach((button) => {
    button.addEventListener("click", () => fitViewport(button.dataset.fitView));
  });

  [els.crossSection, els.flatView].forEach((svgElement) => {
    svgElement.addEventListener("wheel", (event) => zoomViewport(svgElement, event), { passive: false });
    panViewport(svgElement);
  });
  bindDimensionDragging();

  window.addEventListener("resize", () => {
    Object.entries(viewports).forEach(([key, viewport]) => {
      if (!viewport.userAdjusted) fitViewport(key);
    });
  });
}

function handleFlangeEvent(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  const row = event.target.closest(".flange-row");
  const flange = state.flanges[Number(row.dataset.index)];
  if (field === "lengthIn") flange.lengthIn = Math.max(0.01, parseUnitValue(event.target.value));
  if (field === "lengthType") flange.lengthType = event.target.value;
  if (field === "angle") flange.angle = Math.max(0, Math.min(179, Number(event.target.value) || 0));
  if (field === "direction") flange.direction = event.target.value;
  renderCalculated();
}

async function init() {
  applyTheme(initialTheme());
  try {
    const response = await fetch("materials.json");
    state.materials = await response.json();
  } catch {
    state.materials = window.DEFAULT_MATERIALS || [{ material: "Manual", thickness: state.thicknessIn, kFactor: state.kFactor, effectiveBendRadius90: state.bendRadiusIn }];
  }
  populateMaterials();
  applyMaterial(6);
  bindEvents();
  render();
}

init();
