(() => {
  "use strict";

  const root = document.querySelector("[data-worldmodel-map]");
  if (!root) return;

  const canvas = root.querySelector("canvas");
  const context = canvas.getContext("2d");
  const tooltip = root.querySelector("[data-map-tooltip]");
  const status = document.querySelector("[data-map-status]");
  const count = document.querySelector("[data-map-count]");
  const palette = {
    ring: "#9aa7b5",
    hierarchy: "#8c9daf",
    link: "#b8752e",
    linkActive: "#b8752e",
    folder: "#557d9b",
    note: "#a2abb7",
    root: "#2e6f9f",
    active: "#245f8a",
    text: "#263238",
    mutedText: "#66727a"
  };

  let data = null;
  let nodes = [];
  let links = [];
  let radii = [];
  let maxRadius = 1;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let hoveredIndex = -1;
  let frozenIndex = -1;
  let relatedNodes = null;
  const showActiveLinks = true;
  let view = { x: 0, y: 0, scale: 1 };
  let drag = null;
  let animationFrame = 0;
  let reveal = 1;

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const format = new Intl.NumberFormat("en");

  function setStatus(message) {
    status.textContent = message;
    status.parentElement.classList.toggle("has-status", Boolean(message));
  }

  function requestDraw() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      draw();
    });
  }

  function prepareMap(payload) {
    data = payload;
    const isCompact = payload.version >= 2 && Array.isArray(payload.nodes[0]);
    if (isCompact) {
      const decodedNodes = [];
      payload.nodes.forEach((source, index) => {
        const [segment, folderFlag, parentIndex, noteCount, linkCount] = source;
        const parent = parentIndex >= 0 ? decodedNodes[parentIndex] : null;
        const id = parent ? (parent.id ? `${parent.id}/${segment}` : segment) : "";
        const type = folderFlag ? "folder" : "note";
        decodedNodes.push({
          id,
          title: type === "note" ? segment.replace(/\.md$/i, "") : segment || "miniWorldModel",
          type,
          parent: parent ? parent.id : null,
          depth: parent ? parent.depth + 1 : 0,
          noteCount,
          linkCount,
          index,
          parentIndex,
          children: [],
          angle: -Math.PI / 2,
          x: 0,
          y: 0,
          weight: type === "note" ? 1 : 0
        });
      });
      nodes = decodedNodes;
    } else {
      nodes = payload.nodes.map((source, index) => ({
          ...source,
          index,
          parentIndex: -1,
          children: [],
          angle: -Math.PI / 2,
          x: 0,
          y: 0,
          weight: source.type === "note" ? 1 : 0
        }));
    }
    links = payload.links;

    if (isCompact) {
      for (const node of nodes) {
        if (node.parentIndex >= 0) nodes[node.parentIndex].children.push(node.index);
      }
    } else {
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      for (const node of nodes) {
        if (node.parent === null) continue;
        const parent = nodeById.get(node.parent);
        if (!parent) continue;
        node.parentIndex = parent.index;
        parent.children.push(node.index);
      }
    }
    for (const node of nodes) {
      node.children.sort((left, right) => {
        const leftNode = nodes[left];
        const rightNode = nodes[right];
        return Number(rightNode.type === "folder") - Number(leftNode.type === "folder") || leftNode.title.localeCompare(rightNode.title);
      });
    }

    for (const node of [...nodes].sort((left, right) => right.depth - left.depth)) {
      if (node.type === "folder") {
        node.weight = Math.max(1, node.children.reduce((sum, childIndex) => sum + nodes[childIndex].weight, 0));
      }
    }

    const rootNode = nodes.find((node) => node.parent === null) || nodes[0];
    assignAngles(rootNode.index, -Math.PI / 2, Math.PI * 1.5);

    const maxDepth = Math.max(0, ...nodes.map((node) => node.depth));
    const countsByDepth = Array.from({ length: maxDepth + 1 }, () => 0);
    for (const node of nodes) countsByDepth[node.depth] += 1;
    radii = Array.from({ length: maxDepth + 1 }, () => 0);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const circumferenceRadius = countsByDepth[depth] * 34 / (Math.PI * 2);
      radii[depth] = Math.max(depth * 620, radii[depth - 1] + 620, circumferenceRadius);
    }
    maxRadius = Math.max(1, ...radii);

    for (const node of nodes) {
      const angle = node.angle + node.depth * 0.042;
      const radius = radii[node.depth] || 0;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
    }

    count.textContent = `${format.format(payload.counts.notes)} notes · ${format.format(payload.counts.folders)} folders · ${format.format(payload.counts.links)} links`;
    fitMap();
    reveal = 1;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    draw();
    root.classList.add("is-ready");
  }

  function assignAngles(parentIndex, startAngle, endAngle) {
    const parent = nodes[parentIndex];
    if (!parent.children.length) return;
    const totalWeight = parent.children.reduce((sum, childIndex) => sum + nodes[childIndex].weight, 0) || parent.children.length;
    let cursor = startAngle;
    for (const childIndex of parent.children) {
      const child = nodes[childIndex];
      const span = (endAngle - startAngle) * child.weight / totalWeight;
      child.angle = cursor + span / 2;
      assignAngles(childIndex, cursor, cursor + span);
      cursor += span;
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    requestDraw();
  }

  function fitMap() {
    const padding = width < 600 ? 32 : 58;
    const diameter = maxRadius * 2 + 900;
    view = {
      x: 0,
      y: 0,
      scale: clamp(Math.min((width - padding * 2) / diameter, (height - padding * 2) / diameter), 0.002, 1.6)
    };
    requestDraw();
  }

  function worldToScreen(node) {
    return {
      x: (node.x - view.x) * view.scale + width / 2,
      y: (node.y - view.y) * view.scale + height / 2
    };
  }

  function nodeRadius(node, active = false) {
    const importance = node.type === "folder"
      ? 2.2 + Math.log2(node.noteCount + 1) * 0.28
      : 1.15 + Math.log2(node.linkCount + 1) * 0.12;
    return clamp(importance + (active ? 1.7 : 0), node.type === "folder" ? 2.1 : 1.05, active ? 8 : 5.8);
  }

  function visibleAtReveal(node) {
    if (reveal >= 1) return true;
    const depthProgress = node.depth / Math.max(1, radii.length - 1);
    return depthProgress <= reveal * 1.2;
  }

  function draw() {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!data) return;

    drawRings();
    drawHierarchy(false);
    drawNodes();
    if (hoveredIndex >= 0) {
      drawHierarchy(true);
      if (showActiveLinks) drawNoteLinks(true);
    }
    drawLabels();
  }

  function drawRings() {
    context.save();
    context.strokeStyle = palette.ring;
    context.globalAlpha = hoveredIndex >= 0 ? 0.08 : 0.14;
    context.lineWidth = 1;
    const centerX = (0 - view.x) * view.scale + width / 2;
    const centerY = (0 - view.y) * view.scale + height / 2;
    for (let depth = 1; depth < radii.length; depth += 1) {
      if (depth / Math.max(1, radii.length - 1) > reveal * 1.2) continue;
      const radius = radii[depth] * view.scale;
      if (radius < 5 || radius > Math.hypot(width, height) * 1.4) continue;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function drawHierarchy(activePass) {
    context.save();
    context.beginPath();
    for (const node of nodes) {
      if (node.parentIndex < 0 || !visibleAtReveal(node)) continue;
      const isActive = hoveredIndex >= 0 && relatedNodes.has(node.index) && relatedNodes.has(node.parentIndex);
      if (activePass !== isActive) continue;
      const parent = nodes[node.parentIndex];
      const from = worldToScreen(parent);
      const to = worldToScreen(node);
      if (!segmentMightBeVisible(from, to)) continue;
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    context.strokeStyle = activePass ? palette.active : palette.hierarchy;
    context.globalAlpha = activePass ? 0.88 : hoveredIndex >= 0 ? 0.035 : 0.19;
    context.lineWidth = activePass ? 1.55 : 0.7;
    context.stroke();
    context.restore();
  }

  function drawNoteLinks(activePass) {
    context.save();
    context.beginPath();
    for (const [sourceIndex, targetIndex] of links) {
      const isActive = hoveredIndex >= 0 && (sourceIndex === hoveredIndex || targetIndex === hoveredIndex);
      if (activePass !== isActive) continue;
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      if (!source || !target || !visibleAtReveal(source) || !visibleAtReveal(target)) continue;
      const from = worldToScreen(source);
      const to = worldToScreen(target);
      if (!segmentMightBeVisible(from, to)) continue;
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    context.strokeStyle = activePass ? palette.linkActive : palette.link;
    context.globalAlpha = activePass ? 0.78 : hoveredIndex >= 0 ? 0.018 : 0.045;
    context.lineWidth = activePass ? 1.35 : 0.55;
    context.stroke();
    context.restore();
  }

  function segmentMightBeVisible(from, to) {
    const margin = 60;
    return !(from.x < -margin && to.x < -margin)
      && !(from.y < -margin && to.y < -margin)
      && !(from.x > width + margin && to.x > width + margin)
      && !(from.y > height + margin && to.y > height + margin);
  }

  function drawNodes() {
    const passes = ["note", "folder"];
    for (const type of passes) {
      context.save();
      context.beginPath();
      for (const node of nodes) {
        if (node.type !== type || node.index === hoveredIndex || !visibleAtReveal(node)) continue;
        const point = worldToScreen(node);
        if (point.x < -10 || point.y < -10 || point.x > width + 10 || point.y > height + 10) continue;
        const isRelated = hoveredIndex < 0 || relatedNodes.has(node.index);
        context.moveTo(point.x + nodeRadius(node), point.y);
        context.arc(point.x, point.y, nodeRadius(node), 0, Math.PI * 2);
        if (!isRelated) continue;
      }
      context.fillStyle = type === "folder" ? palette.folder : palette.note;
      context.globalAlpha = hoveredIndex >= 0 ? 0.16 : type === "folder" ? 0.9 : 0.72;
      context.fill();
      context.restore();

      if (hoveredIndex >= 0) {
        context.save();
        context.beginPath();
        for (const node of nodes) {
          if (node.type !== type || node.index === hoveredIndex || !relatedNodes.has(node.index) || !visibleAtReveal(node)) continue;
          const point = worldToScreen(node);
          if (point.x < -10 || point.y < -10 || point.x > width + 10 || point.y > height + 10) continue;
          context.moveTo(point.x + nodeRadius(node, true), point.y);
          context.arc(point.x, point.y, nodeRadius(node, true), 0, Math.PI * 2);
        }
        context.fillStyle = palette.active;
        context.globalAlpha = type === "folder" ? 0.94 : 0.72;
        context.fill();
        context.restore();
      }
    }

    const rootNode = nodes[0];
    if (rootNode && visibleAtReveal(rootNode)) drawSingleNode(rootNode, palette.root, hoveredIndex === rootNode.index);
    if (hoveredIndex >= 0) drawSingleNode(nodes[hoveredIndex], palette.linkActive, true);
  }

  function drawSingleNode(node, color, active) {
    const point = worldToScreen(node);
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, nodeRadius(node, active) + (active ? 1 : 0), 0, Math.PI * 2);
    context.fillStyle = color;
    context.globalAlpha = 1;
    context.fill();
    if (active) {
      context.strokeStyle = "rgba(255,255,255,.92)";
      context.lineWidth = 2;
      context.stroke();
    }
    context.restore();
  }

  function drawLabels() {
    const candidates = [];
    for (const node of nodes) {
      if (!visibleAtReveal(node)) continue;
      const forced = node.index === hoveredIndex || node.parent === null || isAncestorOfHovered(node.index);
      const related = hoveredIndex < 0 || relatedNodes.has(node.index);
      const folderEligible = node.type === "folder" && (
        node.depth <= 2
        || view.scale > 0.055 && node.depth <= 4
        || view.scale > 0.15
      );
      const noteEligible = view.scale > 0.42 && node.linkCount > 0;
      if (!forced && !folderEligible && !noteEligible) continue;
      const point = worldToScreen(node);
      if (point.x < -80 || point.y < -30 || point.x > width + 80 || point.y > height + 30) continue;
      candidates.push({
        node,
        point,
        forced,
        related,
        priority: forced
          ? 1e9 - node.depth
          : (hoveredIndex >= 0 && related ? 5e8 : 0)
            + (node.type === "folder" ? node.noteCount * 30 - node.depth : node.linkCount)
      });
    }
    candidates.sort((left, right) => right.priority - left.priority);

    const occupied = [];
    context.save();
    context.font = '500 11px Inter, ui-sans-serif, system-ui, sans-serif';
    context.textBaseline = "middle";
    context.lineJoin = "round";
    let drawn = 0;
    for (const candidate of candidates) {
      if (drawn >= 150 && !candidate.forced) continue;
      const text = candidate.node.title.length > 38 ? `${candidate.node.title.slice(0, 36)}…` : candidate.node.title;
      const textWidth = context.measureText(text).width;
      const box = {
        x: candidate.point.x + nodeRadius(candidate.node) + 5,
        y: candidate.point.y - 7,
        width: textWidth + 4,
        height: 14
      };
      if (!candidate.forced && occupied.some((other) => boxesOverlap(box, other))) continue;
      occupied.push(box);
      context.globalAlpha = candidate.related ? (candidate.forced ? 1 : 0.88) : 0.1;
      context.strokeStyle = "rgba(251,250,246,.92)";
      context.lineWidth = 3;
      context.strokeText(text, box.x + 2, candidate.point.y);
      context.fillStyle = candidate.forced ? palette.text : palette.mutedText;
      context.fillText(text, box.x + 2, candidate.point.y);
      drawn += 1;
    }
    context.restore();
  }

  function boxesOverlap(left, right) {
    return left.x < right.x + right.width + 5
      && left.x + left.width + 5 > right.x
      && left.y < right.y + right.height + 3
      && left.y + left.height + 3 > right.y;
  }

  function isAncestorOfHovered(index) {
    if (hoveredIndex < 0) return false;
    let current = nodes[hoveredIndex].parentIndex;
    while (current >= 0) {
      if (current === index) return true;
      current = nodes[current].parentIndex;
    }
    return false;
  }

  function relatedFor(index) {
    const related = new Set([index]);
    let ancestor = nodes[index].parentIndex;
    while (ancestor >= 0) {
      related.add(ancestor);
      ancestor = nodes[ancestor].parentIndex;
    }
    const stack = [...nodes[index].children];
    while (stack.length) {
      const child = stack.pop();
      if (related.has(child)) continue;
      related.add(child);
      stack.push(...nodes[child].children);
    }
    return related;
  }

  function findNodeAt(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let best = -1;
    let bestDistance = Infinity;
    for (const node of nodes) {
      if (!visibleAtReveal(node)) continue;
      const point = worldToScreen(node);
      const distance = Math.hypot(point.x - x, point.y - y);
      const hitRadius = Math.max(6, nodeRadius(node) + 3);
      if (distance <= hitRadius && distance < bestDistance) {
        best = node.index;
        bestDistance = distance;
      }
    }
    return best;
  }

  function setHovered(index, clientX, clientY, force = false) {
    if (frozenIndex >= 0 && !force) return;
    if (hoveredIndex !== index) {
      hoveredIndex = index;
      relatedNodes = index >= 0 ? relatedFor(index) : null;
      canvas.classList.toggle("is-hovering-node", index >= 0);
      requestDraw();
    }
    if (index >= 0) {
      const node = nodes[index];
      const detail = node.type === "folder" ? `${format.format(node.noteCount)} notes in this branch` : `${format.format(node.linkCount)} connections`;
      setStatus(`${node.title}. ${detail}.`);
      showTooltip(node, clientX, clientY);
    } else {
      setStatus("");
      tooltip.hidden = true;
    }
  }

  function freezeNode(index, clientX, clientY) {
    frozenIndex = index;
    canvas.classList.add("is-frozen");
    setHovered(index, clientX, clientY, true);
  }

  function releaseFrozen() {
    frozenIndex = -1;
    canvas.classList.remove("is-frozen");
    setHovered(-1, undefined, undefined, true);
  }

  function showTooltip(node, clientX, clientY) {
    const bounds = root.getBoundingClientRect();
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.title)}</strong>
      <span>${node.type === "folder" ? `${format.format(node.noteCount)} notes in branch` : `${format.format(node.linkCount)} internal connections`}</span>
      <small>${escapeHtml(node.id || "Vault root")}</small>
    `;
    tooltip.hidden = false;
    const left = clamp(clientX - bounds.left + 14, 10, Math.max(10, bounds.width - tooltip.offsetWidth - 10));
    const top = clamp(clientY - bounds.top + 14, 10, Math.max(10, bounds.height - tooltip.offsetHeight - 10));
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
  }

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }

  function zoomAt(factor, screenX = width / 2, screenY = height / 2) {
    const previousScale = view.scale;
    const nextScale = clamp(previousScale * factor, 0.0015, 2.4);
    const worldX = view.x + (screenX - width / 2) / previousScale;
    const worldY = view.y + (screenY - height / 2) / previousScale;
    view.x = worldX - (screenX - width / 2) / nextScale;
    view.y = worldY - (screenY - height / 2) / nextScale;
    view.scale = nextScale;
    setHovered(-1);
    requestDraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    tooltip.hidden = true;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (drag && drag.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) drag.moved = true;
      view.x = drag.viewX - deltaX / view.scale;
      view.y = drag.viewY - deltaY / view.scale;
      setHovered(-1);
      requestDraw();
      return;
    }
    setHovered(findNodeAt(event.clientX, event.clientY), event.clientX, event.clientY);
  });

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completedDrag = drag;
    drag = null;
    canvas.classList.remove("is-dragging");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!completedDrag.moved) {
      const clickedIndex = findNodeAt(event.clientX, event.clientY);
      if (clickedIndex >= 0) freezeNode(clickedIndex, event.clientX, event.clientY);
      else releaseFrozen();
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", (event) => {
    if (!drag) setHovered(-1, event.clientX, event.clientY);
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0012), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });

  canvas.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoomAt(1.35);
    else if (event.key === "-") zoomAt(1 / 1.35);
    else if (event.key === "0") fitMap();
    else if (event.key === "Escape") releaseFrozen();
    else return;
    event.preventDefault();
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();
  if (window.WORLDMODEL_MAP_DATA) {
    prepareMap(window.WORLDMODEL_MAP_DATA);
  } else {
    root.classList.add("has-error");
    setStatus("The map snapshot could not be loaded.");
  }
})();
