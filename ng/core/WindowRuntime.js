export class WindowRuntime {
  render(definition, root) {
    root.replaceChildren();
    const source = definition || {};
    root.classList.add("ng-runtime-surface");
    if (source.background) root.style.background = source.background;
    const renderNode = (node) => {
      const tag = { label: "span", button: "button", textInput: "input", textarea: "textarea", select: "select", checkbox: "input", image: "img", progress: "progress" }[node.type] || "div";
      const el = document.createElement(tag);
      el.dataset.widgetId = node.widgetId || node.id || "widget";
      if (node.text != null && !["input", "textarea", "select"].includes(tag)) el.textContent = node.text;
      if (tag === "input") { el.type = node.type === "checkbox" ? "checkbox" : "text"; if (node.placeholder) el.placeholder = node.placeholder; }
      if (tag === "textarea") { el.placeholder = node.placeholder || ""; el.textContent = node.text || ""; }
      if (tag === "select") (node.options || [node.text || "选项"]).forEach((option) => { const item = document.createElement("option"); item.textContent = option.label || option; item.value = option.value || option; el.append(item); });
      if (tag === "img") { el.alt = node.alt || node.text || ""; el.src = node.src || ""; }
      if (tag === "progress") { el.max = Number(node.max) || 100; el.value = Number(node.value) || 0; }
      if (node.x != null || node.y != null) { el.style.position = "absolute"; el.style.left = `${Number(node.x) || 0}px`; el.style.top = `${Number(node.y) || 0}px`; }
      if (node.width != null) el.style.width = `${Number(node.width)}px`;
      if (node.height != null) el.style.height = `${Number(node.height)}px`;
      if (node.children) node.children.forEach((child) => el.append(renderNode(child)));
      return el;
    };
    if (Array.isArray(source.widgets)) source.widgets.forEach((widget) => root.append(renderNode(widget)));
    else root.append(renderNode(source.root || { type: "container", children: [] }));
    return root;
  }
}
