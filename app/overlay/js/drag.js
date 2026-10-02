      // ---------- Draggable interaction ----------

      function makeDraggable(elementId, settingsKey, handleSelector, allowButtonDrag = false) {
        const el = document.getElementById(elementId);
        if (!el) return;

        let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
        let isPointerDown = false;
        let isDragging = false;
        let hasMoved = false;

        const getHandle = () => handleSelector ? el.querySelector(handleSelector) || el : el;

        const onPointerDown = (e) => {
          if (!handleSelector) {
            if (e.target.closest("input, select, textarea, a") || e.target.isContentEditable) {
              return;
            }
            if (!allowButtonDrag && e.target.closest("button")) {
              return;
            }
          }
          const evt = e.touches ? e.touches[0] : e;
          isPointerDown = true;
          isDragging = false;
          hasMoved = false;
          const rect = el.getBoundingClientRect();
          startX = evt.clientX;
          startY = evt.clientY;
          initialLeft = rect.left;
          initialTop = rect.top;

          document.addEventListener("mousemove", onPointerMove);
          document.addEventListener("mouseup", onPointerUp);
          document.addEventListener("touchmove", onPointerMove, { passive: false });
          document.addEventListener("touchend", onPointerUp);
        };

        const onPointerMove = (e) => {
          if (!isPointerDown) return;
          const evt = e.touches ? e.touches[0] : e;
          const dx = evt.clientX - startX;
          const dy = evt.clientY - startY;

          if (!isDragging && Math.hypot(dx, dy) > 4) {
            isDragging = true;
            hasMoved = true;
            el.classList.add("ov-dragging");
          }

          if (!isDragging) return;
          if (e.cancelable) e.preventDefault();

          const newLeft = Math.round(initialLeft + dx);
          const newTop = Math.round(initialTop + dy);

          el.style.left = newLeft + "px";
          el.style.top = newTop + "px";
          el.style.right = "auto";
          el.style.bottom = "auto";
          el.style.transform = "none";
        };

        const onPointerUp = () => {
          if (!isPointerDown) return;
          isPointerDown = false;

          if (isDragging) {
            isDragging = false;
            el.classList.remove("ov-dragging");

            const rect = el.getBoundingClientRect();
            settings[settingsKey] = { x: Math.round(rect.left), y: Math.round(rect.top) };
            saveSettings();
          }

          document.removeEventListener("mousemove", onPointerMove);
          document.removeEventListener("mouseup", onPointerUp);
          document.removeEventListener("touchmove", onPointerMove);
          document.removeEventListener("touchend", onPointerUp);
        };

        // Suppress button clicks if the pointer was dragged
        el.addEventListener("click", (e) => {
          if (hasMoved) {
            e.preventDefault();
            e.stopPropagation();
            hasMoved = false;
          }
        }, true);

        const handle = getHandle();
        handle.addEventListener("mousedown", onPointerDown);
        handle.addEventListener("touchstart", onPointerDown, { passive: true });
      }

