/**
 * Runs inside the page. Returns every visible form control with the facts we need
 * to decide what goes in it: label, kind, required, options, current value, and
 * Workday's data-automation-id (stable across companies, so we can map it).
 *
 * Each control is tagged with data-aa-idx="<n>" so later code can target the exact
 * element it read, instead of rebuilding a selector.
 * Approach adapted from browser-use/jev-ultrafast (MIT): read everything in one call.
 */
() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const byIds = (ids) =>
    (ids || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map(text)
      .join(" ");

  // Workday often puts the id on a wrapper (e.g. "formField-legalNameSection_firstName"),
  // so look at the element first, then up the tree.
  const automationId = (el) => el.closest("[data-automation-id]")?.getAttribute("data-automation-id") || null;
  const fieldWrapper = (el) => el.closest('[data-automation-id^="formField-"]');

  const labelOf = (el) => {
    // Buttons, links and list options are named by their visible text (or aria-label).
    const clickable =
      el.tagName === "BUTTON" || el.tagName === "A" || ["button", "option", "link"].includes(el.getAttribute("role"));
    if (clickable) return el.getAttribute("aria-label")?.trim() || text(el) || el.getAttribute("title") || "";
    if (el.getAttribute("aria-labelledby")) return byIds(el.getAttribute("aria-labelledby"));
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return text(label);
    }
    const wrapperLabel = fieldWrapper(el)?.querySelector("label, legend");
    if (wrapperLabel) return text(wrapperLabel);
    const wrapping = el.closest("label");
    return (wrapping && ownText(wrapping)) || el.getAttribute("placeholder") || el.getAttribute("name") || "";
  };

  // A <label> that wraps its control (Lever does this): its visible text, without the text of the
  // controls inside it (a select's options, a button's caption) or of hidden status messages.
  const CONTROL = "select, option, input, textarea, button, a, [role=listbox]";
  const ownText = (label) => {
    const parts = [];
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(CONTROL)) continue;
      if (parent.checkVisibility && !parent.checkVisibility()) continue;
      parts.push(node.textContent);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (tag === "button") return el.getAttribute("aria-haspopup") === "listbox" ? "dropdown" : "button";
    if (tag === "input") return (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "a") return "link";
    return el.getAttribute("role") || tag; // "button", "option", "checkbox", "radio", "combobox"
  };

  const optionsOf = (el, kind) => {
    if (kind === "select") return [...el.options].map((o) => o.text.trim()).filter(Boolean);
    return null; // Workday dropdown options exist only once the list is opened; the agent reads them then.
  };

  const currentValue = (el, kind) => {
    if (kind === "password") return el.value ? "(filled)" : ""; // never read secrets into our data
    if (kind === "checkbox" || kind === "radio") return el.checked;
    if (kind === "dropdown" || kind === "button" || kind === "link" || kind === "option") return text(el);
    if (kind === "file") return el.files?.length ? [...el.files].map((f) => f.name) : null;
    if (kind === "select") return el.value ? (el.selectedOptions[0]?.text.trim() ?? el.value) : ""; // "" while on "Select..."
    return el.value ?? null;
  };

  // Bot traps: fields hidden from people that only bots fill in (Workday's "beecatcher").
  const honeypotOf = (el, label) =>
    automationId(el) === "beecatcher" ||
    /robots only|do not (enter|fill)|leave (this )?(field )?(blank|empty)/i.test(label);

  // Error messages Workday shows after a failed "Save and Continue".
  // Tiny elements are screen-reader announcements ("page is loaded"), not errors a person sees.
  const readable = (el) => {
    const r = el.getBoundingClientRect();
    return visible(el) && r.width > 2 && r.height > 2;
  };
  const looksLikeError = (el) => el.children.length <= 3 && /^\s*error\b/i.test(el.textContent || "");
  const pageErrors = () =>
    [
      ...document.querySelectorAll('[role="alert"], [data-automation-id*="error" i], [data-automation-id*="Error"]'),
      ...[...document.querySelectorAll("p, span, div, li")].filter(looksLikeError), // "Error: Please check the box"
    ]
      .filter(readable)
      .map(text)
      .filter(Boolean)
      .filter((t, i, all) => all.indexOf(t) === i);

  const requiredOf = (el, label) =>
    !["A", "BUTTON"].includes(el.tagName) &&
    (el.required ||
      el.getAttribute("aria-required") === "true" ||
      /\*\s*$/.test(label) ||
      /✱/.test(label) || // Lever: "Resume/CV ✱"
      !!fieldWrapper(el)?.querySelector("abbr[title='required'], [aria-label='required']") ||
      !!el.closest("label")?.querySelector(".required"));

  const selector = [
    "input:not([type=hidden])",
    "select",
    "textarea",
    "button",
    "a[href]",
    "[role=button]", // e.g. Workday's "click_filter" overlays that sit on top of the real button
    "[role=option]", // items of an opened dropdown list
    "[role=combobox]",
    "[role=checkbox]",
    "[role=radio]",
  ].join(",");

  // Hidden from people (aria-hidden) means not clickable by them either: the overlay on top is.
  const hiddenFromPeople = (el) => !!el.closest('[aria-hidden="true"]');

  // Numbers from the previous snapshot must not survive: a stale "2" would point at the wrong element.
  for (const el of document.querySelectorAll("[data-aa-idx]")) el.removeAttribute("data-aa-idx");

  // Custom checkboxes/radios are often a transparent <input> (opacity 0) under a drawn box:
  // still what a click must reach, so count them if they take up space.
  const hasSize = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isToggle = (el) => el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");

  const controls = [...document.querySelectorAll(selector)].filter(
    // File inputs are usually hidden behind a styled button, so keep them even when invisible.
    (el) =>
      (el.tagName === "INPUT" && el.type === "file") ||
      (!hiddenFromPeople(el) && (visible(el) || (isToggle(el) && hasSize(el)))),
  );

  // Header, footer and nav menus: real controls, but never part of filling an application.
  const inPageChrome = (el) =>
    !!el.closest("header, footer, nav, [role=banner], [role=contentinfo], [role=navigation]");

  // Workday's progress bar names the current step: "current step 2 of 6 My Information".
  const stepText = text(document.querySelector('[data-automation-id="progressBarActiveStep"]'));
  const step = stepText.match(/step (\d+) of (\d+)\s*(.*)$/i);

  return {
    url: location.href,
    title: document.title,
    // Try selectors in priority order (a comma list would return whichever comes first in the DOM).
    heading: step
      ? step[3]
      : text(
          ['[data-automation-id="jobPostingHeader"]', '[data-automation-id="jobTitleHeading"]', "h2", "h1"]
            .map((s) => document.querySelector(s))
            .find(Boolean),
        ),
    step: step ? { index: Number(step[1]), total: Number(step[2]), name: step[3] } : null,
    errors: pageErrors(),
    fields: controls.map((el, idx) => {
      el.setAttribute("data-aa-idx", String(idx));
      const kind = kindOf(el);
      const label = labelOf(el);
      return {
        idx,
        kind,
        label,
        automationId: automationId(el),
        fieldWrapper: fieldWrapper(el)?.getAttribute("data-automation-id") || null,
        // For radios/checkboxes the label is the option ("Yes"); the question is on the wrapper.
        question: text(fieldWrapper(el)?.querySelector("legend, label")) || null,
        name: el.getAttribute("name"),
        required: requiredOf(el, label),
        options: optionsOf(el, kind),
        value: currentValue(el, kind),
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        invalid: el.getAttribute("aria-invalid") === "true",
        expanded: el.getAttribute("aria-expanded") === "true", // an open dropdown
        chrome: inPageChrome(el),
        honeypot: honeypotOf(el, label),
      };
    }),
  };
};
