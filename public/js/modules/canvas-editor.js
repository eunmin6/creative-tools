/**
 * Canvas Editor Module
 * 캔버스 에디터 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  let canvasData = { shapes: [] };
  let selectedShape = null;
  let selectedShapes = []; // 다중 선택된 도형들의 인덱스 배열
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let originalShapeData = null;
  let originalShapesData = []; // 다중 선택 시 원본 데이터 배열
  let currentFilePath = null;
  let drawingMode = null; // 'rectangle' or 'circle' or 'line' or null
  let isDrawing = false;
  let drawStartX = 0;
  let drawStartY = 0;
  let isSelectionBoxDragging = false;
  let selectionBoxStart = { x: 0, y: 0 };

  // 무한 캔버스를 위한 뷰포트 오프셋
  let viewportOffsetX = 0;
  let viewportOffsetY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  // 색상 팔레트
  const pasteColors = ['#616161', '#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFC9BA', '#D4A5A5', '#9EC1CF'];
  let colorPaletteVisible = false;

  // ===== 헬퍼 함수 =====

  // 월드 좌표를 화면 좌표로 변환
  function worldToScreen(x, y) {
    return {
      x: x + viewportOffsetX,
      y: y + viewportOffsetY
    };
  }

  // 화면 좌표를 월드 좌표로 변환
  function screenToWorld(x, y) {
    return {
      x: x - viewportOffsetX,
      y: y - viewportOffsetY
    };
  }

  // 연결점 좌표 계산
  function getConnectionPointPosition(shapeIndex, position) {
    const shape = canvasData.shapes[shapeIndex];
    if (!shape || shape.type !== 'rectangle') return null;

    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;

    switch(position) {
      case 'top': return { x: centerX, y: shape.y };
      case 'bottom': return { x: centerX, y: shape.y + shape.height };
      case 'left': return { x: shape.x, y: centerY };
      case 'right': return { x: shape.x + shape.width, y: centerY };
      default: return null;
    }
  }

  // 가장 가까운 연결점 찾기
  function findNearestConnectionPoint(x, y, snapDistance = 15) {
    let nearestPoint = null;
    let minDistance = snapDistance;

    canvasData.shapes.forEach((shape, index) => {
      if (shape.type !== 'rectangle') return;

      ['top', 'bottom', 'left', 'right'].forEach(position => {
        const point = getConnectionPointPosition(index, position);
        if (!point) return;

        const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
        if (distance < minDistance) {
          minDistance = distance;
          nearestPoint = {
            shapeIndex: index,
            position: position,
            x: point.x,
            y: point.y
          };
        }
      });
    });

    return nearestPoint;
  }

  // 사각형에 연결된 모든 선을 업데이트
  function updateConnectedLines(rectangleIndex) {
    canvasData.shapes.forEach((shape, index) => {
      if (shape.type !== 'line') return;

      if (shape.startConnection && shape.startConnection.shapeIndex === rectangleIndex) {
        const connectionPoint = getConnectionPointPosition(rectangleIndex, shape.startConnection.position);
        if (connectionPoint) {
          const endX = shape.x + shape.width;
          const endY = shape.y + shape.height;
          shape.x = connectionPoint.x;
          shape.y = connectionPoint.y;
          shape.width = endX - connectionPoint.x;
          shape.height = endY - connectionPoint.y;
        }
      }

      if (shape.endConnection && shape.endConnection.shapeIndex === rectangleIndex) {
        const connectionPoint = getConnectionPointPosition(rectangleIndex, shape.endConnection.position);
        if (connectionPoint) {
          shape.width = connectionPoint.x - shape.x;
          shape.height = connectionPoint.y - shape.y;
        }
      }
    });
  }

  // ===== 색상 팔레트 =====

  function initColorPalette() {
    const palette = document.getElementById('colorPalette');
    if (!palette) return;
    if (palette.dataset.initialized === 'true') return;
    palette.dataset.initialized = 'true';

    palette.innerHTML = '';
    pasteColors.forEach(color => {
      const colorOption = document.createElement('div');
      colorOption.className = 'color-option';
      colorOption.style.backgroundColor = color;
      colorOption.dataset.color = color;

      colorOption.addEventListener('click', (e) => {
        e.stopPropagation();
        changeShapeColor(color);
      });

      palette.appendChild(colorOption);
    });

    document.addEventListener('click', (e) => {
      if (!palette.contains(e.target) && !e.target.closest('.canvas-shape')) {
        hideColorPalette();
      }
    });
  }

  function showColorPalette() {
    const palette = document.getElementById('colorPalette');
    if (!palette) return;

    palette.innerHTML = '';
    pasteColors.forEach(color => {
      const colorOption = document.createElement('div');
      colorOption.className = 'color-option';
      colorOption.style.backgroundColor = color;
      colorOption.dataset.color = color;

      colorOption.addEventListener('click', (e) => {
        e.stopPropagation();
        changeShapeColor(color);
      });

      palette.appendChild(colorOption);
    });

    palette.classList.add('show');
    colorPaletteVisible = true;

    if (selectedShape !== null) {
      const currentColor = canvasData.shapes[selectedShape].color;
      palette.querySelectorAll('.color-option').forEach(option => {
        option.classList.toggle('selected', option.dataset.color === currentColor);
      });
    }
  }

  function hideColorPalette() {
    const palette = document.getElementById('colorPalette');
    if (!palette) return;
    palette.classList.remove('show');
    colorPaletteVisible = false;
  }

  function changeShapeColor(color) {
    const tabs = window.AppState ? window.AppState.tabs : { list: window.openTabs || [], activeIndex: window.activeTabIndex || -1 };

    if (selectedShape !== null) {
      canvasData.shapes[selectedShape].color = color;
      renderShapes();
      if (tabs.activeIndex >= 0 && tabs.list[tabs.activeIndex]) {
        tabs.list[tabs.activeIndex].content = JSON.stringify(canvasData, null, 2);
      }
    } else if (selectedShapes.length > 0) {
      selectedShapes.forEach(index => {
        canvasData.shapes[index].color = color;
      });
      renderShapes();
      if (tabs.activeIndex >= 0 && tabs.list[tabs.activeIndex]) {
        tabs.list[tabs.activeIndex].content = JSON.stringify(canvasData, null, 2);
      }
    }
  }

  // ===== 리사이즈 핸들 =====

  function addResizeHandles(shapeEl) {
    const handleSize = '8px';
    const handleColor = '#ffffff';

    const handles = [
      { position: 'top-left', top: '-5px', left: '-5px', cursor: 'nwse-resize' },
      { position: 'top-right', top: '-5px', right: '-5px', cursor: 'nesw-resize' },
      { position: 'bottom-left', bottom: '-5px', left: '-5px', cursor: 'nesw-resize' },
      { position: 'bottom-right', bottom: '-5px', right: '-5px', cursor: 'nwse-resize' },
      { position: 'top', top: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
      { position: 'bottom', bottom: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
      { position: 'left', left: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
      { position: 'right', right: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }
    ];

    handles.forEach(h => {
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.dataset.position = h.position;
      handle.style.position = 'absolute';
      handle.style.width = handleSize;
      handle.style.height = handleSize;
      handle.style.background = handleColor;
      handle.style.cursor = h.cursor;
      handle.style.borderRadius = '2px';
      handle.style.border = '1px solid #007acc';
      handle.style.boxShadow = '0 0 2px rgba(0, 0, 0, 0.5)';

      if (h.top) handle.style.top = h.top;
      if (h.bottom) handle.style.bottom = h.bottom;
      if (h.left) handle.style.left = h.left;
      if (h.right) handle.style.right = h.right;
      if (h.transform) handle.style.transform = h.transform;

      shapeEl.appendChild(handle);
    });
  }

  function addLineHandles(shapeEl, shape, minX, minY) {
    const handleSize = '10px';
    const handleColor = '#ffffff';

    const startX = shape.x - minX;
    const startY = shape.y - minY;
    const endX = (shape.x + shape.width) - minX;
    const endY = (shape.y + shape.height) - minY;

    if (shape.startConnection && shape.endConnection) {
      const startPos = shape.startConnection.position;
      const endPos = shape.endConnection.position;

      const isSameDirection =
        (startPos === 'top' && endPos === 'top') ||
        (startPos === 'bottom' && endPos === 'bottom') ||
        (startPos === 'left' && endPos === 'left') ||
        (startPos === 'right' && endPos === 'right');

      const isPerpendicularConnection =
        ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
        ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

      let midHandleX, midHandleY, midCursor;

      if (isSameDirection) {
        const offsetDist = shape.offsetDistance || 30;
        if (startPos === 'top' || startPos === 'bottom') {
          const yOffset = startPos === 'top' ? -offsetDist : offsetDist;
          const midY = Math.min(startY, endY) + yOffset;
          midHandleX = startX + (endX - startX) * shape.middlePoint;
          midHandleY = midY;
          midCursor = 'ns-resize';
        } else {
          const xOffset = startPos === 'left' ? -offsetDist : offsetDist;
          const midX = Math.min(startX, endX) + xOffset;
          midHandleX = midX;
          midHandleY = startY + (endY - startY) * shape.middlePoint;
          midCursor = 'ew-resize';
        }
      } else if (isPerpendicularConnection) {
        const offsetDist = shape.offsetDistance || 30;
        if (startPos === 'top' || startPos === 'bottom') {
          const yOffset = startPos === 'top' ? -offsetDist : offsetDist;
          const yExit = startY + yOffset;
          const xOffset = endPos === 'left' ? -offsetDist : offsetDist;
          const xExit = endX + xOffset;
          midHandleX = (startX + xExit) / 2;
          midHandleY = yExit;
          midCursor = 'ns-resize';
        } else {
          const xOffset = startPos === 'left' ? -offsetDist : offsetDist;
          const xExit = startX + xOffset;
          const yOffset = endPos === 'top' ? -offsetDist : offsetDist;
          const yExit = endY + yOffset;
          midHandleX = xExit;
          midHandleY = (startY + yExit) / 2;
          midCursor = 'ew-resize';
        }
      } else {
        const isHorizontalFirst = shape.isHorizontalFirst;
        if (isHorizontalFirst) {
          midHandleX = startX + (endX - startX) * shape.middlePoint;
          midHandleY = (startY + endY) / 2;
          midCursor = 'ew-resize';
        } else {
          midHandleX = (startX + endX) / 2;
          midHandleY = startY + (endY - startY) * shape.middlePoint;
          midCursor = 'ns-resize';
        }
      }

      const midHandle = document.createElement('div');
      midHandle.className = 'resize-handle';
      midHandle.dataset.position = 'middle';
      midHandle.style.cssText = `
        position: absolute;
        width: ${handleSize};
        height: ${handleSize};
        background: #ffd700;
        cursor: ${midCursor};
        border-radius: 50%;
        border: 2px solid #007acc;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
        left: ${midHandleX - 5}px;
        top: ${midHandleY - 5}px;
      `;
      shapeEl.appendChild(midHandle);
    } else {
      // 일반 직선: 시작점과 끝점 핸들
      const startHandle = document.createElement('div');
      startHandle.className = 'resize-handle';
      startHandle.dataset.position = 'start';
      startHandle.style.cssText = `
        position: absolute;
        width: ${handleSize};
        height: ${handleSize};
        background: ${handleColor};
        cursor: move;
        border-radius: 50%;
        border: 2px solid #007acc;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
        left: ${startX - 5}px;
        top: ${startY - 5}px;
      `;

      const endHandle = document.createElement('div');
      endHandle.className = 'resize-handle';
      endHandle.dataset.position = 'end';
      endHandle.style.cssText = `
        position: absolute;
        width: ${handleSize};
        height: ${handleSize};
        background: ${handleColor};
        cursor: move;
        border-radius: 50%;
        border: 2px solid #007acc;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
        left: ${endX - 5}px;
        top: ${endY - 5}px;
      `;

      shapeEl.appendChild(startHandle);
      shapeEl.appendChild(endHandle);
    }
  }

  function addConnectionPoints(shapeEl, shapeIndex) {
    const pointSize = '8px';
    const pointColor = '#89d185';

    const points = [
      { position: 'top', top: '-4px', left: '50%', transform: 'translateX(-50%)' },
      { position: 'bottom', bottom: '-4px', left: '50%', transform: 'translateX(-50%)' },
      { position: 'left', left: '-4px', top: '50%', transform: 'translateY(-50%)' },
      { position: 'right', right: '-4px', top: '50%', transform: 'translateY(-50%)' }
    ];

    points.forEach(p => {
      const point = document.createElement('div');
      point.className = 'connection-point';
      point.dataset.shapeIndex = shapeIndex;
      point.dataset.position = p.position;
      point.style.cssText = `
        position: absolute;
        width: ${pointSize};
        height: ${pointSize};
        background: ${pointColor};
        border: 1px solid #ffffff;
        border-radius: 50%;
        cursor: crosshair;
        z-index: 10;
        pointer-events: none;
      `;

      if (p.top) point.style.top = p.top;
      if (p.bottom) point.style.bottom = p.bottom;
      if (p.left) point.style.left = p.left;
      if (p.right) point.style.right = p.right;
      if (p.transform) point.style.transform = p.transform;

      shapeEl.appendChild(point);
    });
  }

  // ===== 도형 렌더링 =====

  function renderShapes() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    container.innerHTML = '';

    canvasData.shapes.forEach((shape, index) => {
      if (shape.type === 'line') {
        renderLineShape(container, shape, index);
      } else {
        renderRectOrCircleShape(container, shape, index);
      }
    });
  }

  function renderLineShape(container, shape, index) {
    const shapeEl = document.createElement('div');
    shapeEl.className = 'canvas-shape';
    shapeEl.dataset.index = index;
    shapeEl.style.position = 'absolute';

    const minX = Math.min(shape.x, shape.x + shape.width);
    const minY = Math.min(shape.y, shape.y + shape.height);
    const maxX = Math.max(shape.x, shape.x + shape.width);
    const maxY = Math.max(shape.y, shape.y + shape.height);

    const screenPos = worldToScreen(minX, minY);
    shapeEl.style.left = screenPos.x + 'px';
    shapeEl.style.top = screenPos.y + 'px';
    shapeEl.style.width = (maxX - minX) + 'px';
    shapeEl.style.height = (maxY - minY) + 'px';
    shapeEl.style.cursor = 'move';
    shapeEl.style.pointerEvents = 'all';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';

    if (shape.startConnection && shape.endConnection) {
      renderOrthogonalLine(svg, shape, minX, minY, index);
    } else {
      renderStraightLine(svg, shape, minX, minY, index);
    }

    shapeEl.appendChild(svg);

    if (selectedShape === index || selectedShapes.includes(index)) {
      shapeEl.style.filter = 'drop-shadow(0 0 4px rgba(0, 122, 204, 0.6))';
      if (selectedShape === index) {
        addLineHandles(shapeEl, shape, minX, minY);
      }
    }

    container.appendChild(shapeEl);
  }

  function renderOrthogonalLine(svg, shape, minX, minY, index) {
    if (!shape.middlePoint) shape.middlePoint = 0.5;
    if (!shape.middlePoint2) shape.middlePoint2 = 0.5;

    const x1 = shape.x - minX;
    const y1 = shape.y - minY;
    const x2 = (shape.x + shape.width) - minX;
    const y2 = (shape.y + shape.height) - minY;

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');

    const startPos = shape.startConnection.position;
    const endPos = shape.endConnection.position;

    const isSameDirection =
      (startPos === 'top' && endPos === 'top') ||
      (startPos === 'bottom' && endPos === 'bottom') ||
      (startPos === 'left' && endPos === 'left') ||
      (startPos === 'right' && endPos === 'right');

    const isPerpendicularConnection =
      ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
      ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

    let points;

    if (isSameDirection) {
      if (shape.offsetDistance === undefined) shape.offsetDistance = 30;

      if (startPos === 'top' || startPos === 'bottom') {
        const yOffset = startPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
        const midY = Math.min(y1, y2) + yOffset;
        const midX1 = x1 + (x2 - x1) * shape.middlePoint;
        points = `${x1},${y1} ${x1},${midY} ${midX1},${midY} ${x2},${midY} ${x2},${y2}`;
      } else {
        const xOffset = startPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
        const midX = Math.min(x1, x2) + xOffset;
        const midY1 = y1 + (y2 - y1) * shape.middlePoint;
        points = `${x1},${y1} ${midX},${y1} ${midX},${midY1} ${midX},${y2} ${x2},${y2}`;
      }
    } else if (isPerpendicularConnection) {
      if (shape.offsetDistance === undefined) shape.offsetDistance = 30;

      if (startPos === 'top' || startPos === 'bottom') {
        const yOffset = startPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
        const yExit = y1 + yOffset;
        const xOffset = endPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
        const xExit = x2 + xOffset;
        points = `${x1},${y1} ${x1},${yExit} ${xExit},${yExit} ${xExit},${y2} ${x2},${y2}`;
      } else {
        const xOffset = startPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
        const xExit = x1 + xOffset;
        const yOffset = endPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
        const yExit = y2 + yOffset;
        points = `${x1},${y1} ${xExit},${y1} ${xExit},${yExit} ${x2},${yExit} ${x2},${y2}`;
      }
    } else {
      if (shape.isHorizontalFirst === undefined) {
        if (startPos === 'left' || startPos === 'right') {
          shape.isHorizontalFirst = true;
        } else if (startPos === 'top' || startPos === 'bottom') {
          shape.isHorizontalFirst = false;
        } else {
          shape.isHorizontalFirst = Math.abs(shape.width) > Math.abs(shape.height);
        }
      }

      if (shape.isHorizontalFirst) {
        const midX = x1 + (x2 - x1) * shape.middlePoint;
        points = `${x1},${y1} ${midX},${y1} ${midX},${y2} ${x2},${y2}`;
      } else {
        const midY = y1 + (y2 - y1) * shape.middlePoint;
        points = `${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      }
    }

    polyline.setAttribute('points', points);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', (selectedShape === index || selectedShapes.includes(index)) ? '#007acc' : '#616161');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(polyline);
  }

  function renderStraightLine(svg, shape, minX, minY, index) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');

    const x1 = shape.x - minX;
    const y1 = shape.y - minY;
    const x2 = (shape.x + shape.width) - minX;
    const y2 = (shape.y + shape.height) - minY;

    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', (selectedShape === index || selectedShapes.includes(index)) ? '#007acc' : '#616161');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');

    svg.appendChild(line);
  }

  function renderRectOrCircleShape(container, shape, index) {
    const shapeEl = document.createElement('div');
    shapeEl.className = 'canvas-shape';
    shapeEl.dataset.index = index;
    shapeEl.style.position = 'absolute';

    const screenPos = worldToScreen(shape.x, shape.y);
    shapeEl.style.left = screenPos.x + 'px';
    shapeEl.style.top = screenPos.y + 'px';
    shapeEl.style.width = shape.width + 'px';
    shapeEl.style.height = shape.height + 'px';
    shapeEl.style.cursor = 'move';
    shapeEl.style.border = '2px solid #3e3e42';
    shapeEl.style.background = shape.color || '#616161';

    if (shape.type === 'circle') {
      shapeEl.style.borderRadius = '50%';
    }

    if (selectedShape === index || selectedShapes.includes(index)) {
      shapeEl.style.border = '2px solid #007acc';
      shapeEl.style.boxShadow = '0 0 8px rgba(0, 122, 204, 0.6)';

      if (selectedShape === index) {
        addResizeHandles(shapeEl);
      }
    }

    if (shape.type === 'rectangle' && drawingMode === 'line') {
      addConnectionPoints(shapeEl, index);
    }

    container.appendChild(shapeEl);
  }

  // ===== 이벤트 핸들러 =====

  function setupCanvasEvents() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    container.addEventListener('mousedown', handleCanvasMouseDown);
    document.addEventListener('mousemove', handleCanvasMouseMove);
    document.addEventListener('mouseup', handleCanvasMouseUp);
  }

  function handleCanvasMouseDown(e) {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();

    if (drawingMode) {
      isDrawing = true;
      const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      drawStartX = worldPos.x;
      drawStartY = worldPos.y;

      canvasData.shapes.push({
        type: drawingMode,
        x: drawStartX,
        y: drawStartY,
        width: 0,
        height: 0,
        color: '#616161'
      });
      selectedShape = canvasData.shapes.length - 1;
      return;
    }

    const shapeEl = e.target.closest('.canvas-shape');

    if (!shapeEl) {
      if (!e.ctrlKey) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        selectedShape = null;
        selectedShapes = [];
        container.style.cursor = 'grabbing';
        hideColorPalette();
      }
      renderShapes();
      return;
    }

    const index = parseInt(shapeEl.dataset.index);

    if (e.ctrlKey) {
      if (selectedShape !== null && selectedShapes.length === 0) {
        selectedShapes.push(selectedShape);
        selectedShape = null;
      }

      const shapeIndex = selectedShapes.indexOf(index);
      if (shapeIndex > -1) {
        selectedShapes.splice(shapeIndex, 1);
      } else {
        selectedShapes.push(index);
      }
      renderShapes();
      return;
    }

    if (selectedShapes.length > 0 && selectedShapes.includes(index)) {
      // 다중 선택된 도형 중 하나를 클릭 - 드래그 준비
    } else {
      selectedShape = index;
      selectedShapes = [];
    }

    const shape = canvasData.shapes[index];
    if (shape.type === 'rectangle' || shape.type === 'circle') {
      showColorPalette();
    } else {
      hideColorPalette();
    }

    if (e.target.classList.contains('resize-handle')) {
      isResizing = true;
      resizeHandle = e.target.dataset.position;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      originalShapeData = { ...canvasData.shapes[index] };
    } else {
      const shape = canvasData.shapes[index];
      const isConnectedLine = shape.type === 'line' && shape.startConnection && shape.endConnection;

      if (!isConnectedLine) {
        isDragging = true;
        resizeHandle = null;
        const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        if (selectedShapes.length > 0 && selectedShapes.includes(index)) {
          dragStartX = worldPos.x;
          dragStartY = worldPos.y;
          originalShapesData = selectedShapes.map(i => ({
            index: i,
            data: { ...canvasData.shapes[i] }
          }));
        } else {
          dragStartX = worldPos.x - canvasData.shapes[index].x;
          dragStartY = worldPos.y - canvasData.shapes[index].y;
        }
      }
    }

    renderShapes();
  }

  function handleCanvasMouseMove(e) {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();

    if (isPanning) {
      const deltaX = e.clientX - panStartX;
      const deltaY = e.clientY - panStartY;
      viewportOffsetX += deltaX;
      viewportOffsetY += deltaY;
      panStartX = e.clientX;
      panStartY = e.clientY;
      renderShapes();
      return;
    }

    if (isDrawing && selectedShape !== null) {
      const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const currentX = worldPos.x;
      const currentY = worldPos.y;

      const shape = canvasData.shapes[selectedShape];
      const width = currentX - drawStartX;
      const height = currentY - drawStartY;

      if (shape.type === 'line') {
        shape.x = drawStartX;
        shape.y = drawStartY;

        const endX = drawStartX + width;
        const endY = drawStartY + height;
        const nearestPoint = findNearestConnectionPoint(endX, endY);

        if (nearestPoint) {
          shape.width = nearestPoint.x - drawStartX;
          shape.height = nearestPoint.y - drawStartY;
        } else {
          shape.width = width;
          shape.height = height;
        }
      } else {
        shape.x = width >= 0 ? drawStartX : currentX;
        shape.y = height >= 0 ? drawStartY : currentY;
        shape.width = Math.abs(width);
        shape.height = Math.abs(height);
      }

      renderShapes();
      return;
    }

    if (!isDragging && !isResizing) return;
    if (selectedShape === null && selectedShapes.length === 0) return;

    if (isDragging) {
      const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      if (originalShapesData.length > 0) {
        const deltaX = worldPos.x - dragStartX;
        const deltaY = worldPos.y - dragStartY;

        originalShapesData.forEach(item => {
          const shape = canvasData.shapes[item.index];
          shape.x = item.data.x + deltaX;
          shape.y = item.data.y + deltaY;

          if (shape.type === 'rectangle') {
            updateConnectedLines(item.index);
          }
        });
      } else {
        const shape = canvasData.shapes[selectedShape];
        shape.x = worldPos.x - dragStartX;
        shape.y = worldPos.y - dragStartY;

        if (shape.type === 'rectangle') {
          updateConnectedLines(selectedShape);
        }
      }
    } else if (isResizing && originalShapeData) {
      handleResize(e);
    }

    renderShapes();
  }

  function handleResize(e) {
    const shape = canvasData.shapes[selectedShape];
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    const minSize = 20;

    switch (resizeHandle) {
      case 'bottom-right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'bottom-left':
        const newWidthBL = originalShapeData.width - deltaX;
        if (newWidthBL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthBL;
        }
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'top-right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        const newHeightTR = originalShapeData.height - deltaY;
        if (newHeightTR >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightTR;
        }
        break;
      case 'top-left':
        const newWidthTL = originalShapeData.width - deltaX;
        const newHeightTL = originalShapeData.height - deltaY;
        if (newWidthTL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthTL;
        }
        if (newHeightTL >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightTL;
        }
        break;
      case 'top':
        const newHeightT = originalShapeData.height - deltaY;
        if (newHeightT >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightT;
        }
        break;
      case 'bottom':
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'left':
        const newWidthL = originalShapeData.width - deltaX;
        if (newWidthL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthL;
        }
        break;
      case 'right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        break;
      case 'start':
        handleLineStartResize(shape, deltaX, deltaY);
        break;
      case 'end':
        handleLineEndResize(shape, deltaX, deltaY);
        break;
      case 'middle':
        handleLineMiddleResize(shape, deltaX, deltaY);
        break;
    }

    if (shape.type === 'rectangle') {
      updateConnectedLines(selectedShape);
    }
  }

  function handleLineStartResize(shape, deltaX, deltaY) {
    const newStartX = originalShapeData.x + deltaX;
    const newStartY = originalShapeData.y + deltaY;
    const nearestPoint = findNearestConnectionPoint(newStartX, newStartY);

    if (nearestPoint) {
      shape.x = nearestPoint.x;
      shape.y = nearestPoint.y;
      shape.width = originalShapeData.width + (originalShapeData.x - nearestPoint.x);
      shape.height = originalShapeData.height + (originalShapeData.y - nearestPoint.y);
    } else {
      shape.x = newStartX;
      shape.y = newStartY;
      shape.width = originalShapeData.width - deltaX;
      shape.height = originalShapeData.height - deltaY;
    }
  }

  function handleLineEndResize(shape, deltaX, deltaY) {
    const newEndX = originalShapeData.x + originalShapeData.width + deltaX;
    const newEndY = originalShapeData.y + originalShapeData.height + deltaY;
    const nearestPoint = findNearestConnectionPoint(newEndX, newEndY);

    if (nearestPoint) {
      shape.width = nearestPoint.x - originalShapeData.x;
      shape.height = nearestPoint.y - originalShapeData.y;
    } else {
      shape.width = originalShapeData.width + deltaX;
      shape.height = originalShapeData.height + deltaY;
    }
  }

  function handleLineMiddleResize(shape, deltaX, deltaY) {
    const startPos = originalShapeData.startConnection.position;
    const endPos = originalShapeData.endConnection.position;

    const isSameDirection =
      (startPos === 'top' && endPos === 'top') ||
      (startPos === 'bottom' && endPos === 'bottom') ||
      (startPos === 'left' && endPos === 'left') ||
      (startPos === 'right' && endPos === 'right');

    const isPerpendicularConnection =
      ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
      ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

    if (isSameDirection || isPerpendicularConnection) {
      const originalOffset = originalShapeData.offsetDistance || 30;
      if (startPos === 'top' || startPos === 'bottom') {
        const multiplier = startPos === 'top' ? -1 : 1;
        shape.offsetDistance = Math.max(10, originalOffset + deltaY * multiplier);
      } else {
        const multiplier = startPos === 'left' ? -1 : 1;
        shape.offsetDistance = Math.max(10, originalOffset + deltaX * multiplier);
      }
    } else {
      const isHorizontalFirst = originalShapeData.isHorizontalFirst;
      if (isHorizontalFirst) {
        const totalWidth = originalShapeData.width;
        const newMiddlePoint = (originalShapeData.middlePoint * totalWidth + deltaX) / totalWidth;
        shape.middlePoint = Math.max(0, Math.min(1, newMiddlePoint));
      } else {
        const totalHeight = originalShapeData.height;
        const newMiddlePoint = (originalShapeData.middlePoint * totalHeight + deltaY) / totalHeight;
        shape.middlePoint = Math.max(0, Math.min(1, newMiddlePoint));
      }
    }
  }

  function handleCanvasMouseUp() {
    const container = document.getElementById('canvas-container');

    if (isPanning) {
      isPanning = false;
      if (container) container.style.cursor = '';
      return;
    }

    if (isDrawing) {
      isDrawing = false;

      if (selectedShape !== null) {
        const shape = canvasData.shapes[selectedShape];
        const minSize = 5;

        if (shape.type === 'line') {
          if (Math.abs(shape.width) < minSize && Math.abs(shape.height) < minSize) {
            canvasData.shapes.splice(selectedShape, 1);
            selectedShape = null;
          } else {
            const startPoint = findNearestConnectionPoint(shape.x, shape.y);
            const endPoint = findNearestConnectionPoint(shape.x + shape.width, shape.y + shape.height);
            if (startPoint) shape.startConnection = { shapeIndex: startPoint.shapeIndex, position: startPoint.position };
            if (endPoint) shape.endConnection = { shapeIndex: endPoint.shapeIndex, position: endPoint.position };
          }
        } else {
          if (shape.width < minSize || shape.height < minSize) {
            canvasData.shapes.splice(selectedShape, 1);
            selectedShape = null;
          }
        }
      }

      exitDrawingMode();
      renderShapes();
      return;
    }

    if (isResizing && selectedShape !== null && resizeHandle) {
      const shape = canvasData.shapes[selectedShape];
      if (shape && shape.type === 'line') {
        if (resizeHandle === 'start') {
          const startPoint = findNearestConnectionPoint(shape.x, shape.y);
          shape.startConnection = startPoint ? { shapeIndex: startPoint.shapeIndex, position: startPoint.position } : null;
        } else if (resizeHandle === 'end') {
          const endPoint = findNearestConnectionPoint(shape.x + shape.width, shape.y + shape.height);
          shape.endConnection = endPoint ? { shapeIndex: endPoint.shapeIndex, position: endPoint.position } : null;
        }
      }
    }

    isDragging = false;
    isResizing = false;
    resizeHandle = null;
    originalShapeData = null;
    originalShapesData = [];
  }

  // ===== 도형 추가/삭제 =====

  function addRectangle() {
    drawingMode = 'rectangle';
    updateCanvasCursor();
  }

  function addCircle() {
    drawingMode = 'circle';
    updateCanvasCursor();
  }

  function addLine() {
    drawingMode = 'line';
    updateCanvasCursor();
    renderShapes();
  }

  function exitDrawingMode() {
    drawingMode = null;
    isDrawing = false;
    updateCanvasCursor();
  }

  function updateCanvasCursor() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    container.style.cursor = drawingMode ? 'crosshair' : 'default';
  }

  function deleteSelectedShape() {
    if (selectedShape !== null) {
      canvasData.shapes.splice(selectedShape, 1);
      selectedShape = null;
      renderShapes();
    }
  }

  // ===== 키보드 이벤트 =====

  function handleCanvasKeyDown(e) {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (typeof window.saveCurrentFile === 'function') {
        window.saveCurrentFile();
      }
      return;
    }

    if (!document.getElementById('canvas-editor')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      exitDrawingMode();
    }

    if (e.key === 'Delete' && selectedShape !== null) {
      e.preventDefault();
      deleteSelectedShape();
    }
  }

  // ===== 파일 저장 =====

  async function saveCanvas() {
    if (!currentFilePath) return;

    const jsonContent = JSON.stringify(canvasData, null, 2);
    const tabs = window.AppState ? window.AppState.tabs : { list: window.openTabs || [], activeIndex: window.activeTabIndex || -1 };

    try {
      const result = await window.electronAPI.fs.writeFile(currentFilePath, jsonContent);
      if (result.success) {
        if (tabs.activeIndex >= 0 && tabs.list[tabs.activeIndex]) {
          tabs.list[tabs.activeIndex].content = jsonContent;
          tabs.list[tabs.activeIndex].originalContent = jsonContent;
          if (typeof window.renderTabs === 'function') {
            window.renderTabs();
          }
        }
      } else {
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to save file: ' + result.error, 'error');
        }
      }
    } catch (error) {
      if (typeof window.showToast === 'function') {
        window.showToast('Error saving file: ' + error, 'error');
      }
    }
  }

  // ===== 캔버스 에디터 열기 =====

  function openCanvasEditorForTab(tab) {
    currentFilePath = tab.filePath;
    const editorArea = document.querySelector('.editor-area');

    try {
      canvasData = tab.content.trim() ? JSON.parse(tab.content) : { shapes: [] };
    } catch (e) {
      canvasData = { shapes: [] };
    }

    // Reset viewport
    viewportOffsetX = 0;
    viewportOffsetY = 0;
    selectedShape = null;
    selectedShapes = [];

    editorArea.innerHTML = `
      <div id="canvas-editor" style="width: 100%; height: 100%; display: flex; flex-direction: row; background: #252526; position: relative;">
        <div id="canvas-container" style="flex: 1; position: relative; overflow: hidden; background-color: #252526; background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px); background-size: 20px 20px;">
        </div>
        <div id="canvas-toolbar" style="width: 48px; background: #2d2d2d; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 4px; border-left: 1px solid #1e1e1e;">
          <button onclick="addRectangle()" title="Add Rectangle" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="14" height="14" rx="1"/>
            </svg>
          </button>
          <button onclick="addCircle()" title="Add Circle" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="10" cy="10" r="7"/>
            </svg>
          </button>
          <button onclick="addLine()" title="Add Line" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="17" x2="17" y2="3"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    renderShapes();
    setupCanvasEvents();

    const toolbarButtons = document.querySelectorAll('#canvas-toolbar button');
    toolbarButtons.forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = '#3e3e42');
      btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    });

    initColorPalette();
  }

  // ===== 전역 노출 =====
  window.openCanvasEditorForTab = openCanvasEditorForTab;
  window.addRectangle = addRectangle;
  window.addCircle = addCircle;
  window.addLine = addLine;
  window.deleteSelectedShape = deleteSelectedShape;
  window.saveCanvas = saveCanvas;
  window.handleCanvasKeyDown = handleCanvasKeyDown;
  window.renderShapes = renderShapes;

  // Getter for canvasData (for external access if needed)
  window.getCanvasData = () => canvasData;
  window.setCanvasData = (data) => { canvasData = data; };

})();
