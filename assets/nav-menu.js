(() => {
  const menus = document.querySelectorAll(".nav-menu, .theme-switcher");

  const closeMenus = (except) => {
    menus.forEach((menu) => {
      if (menu !== except) menu.removeAttribute("open");
    });
  };

  menus.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (menu.open) closeMenus(menu);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (![...menus].some((menu) => menu.contains(event.target))) closeMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
})();
