// A full page load to another path (6.1): after logging out from a cached public page, so the next
// page is fetched fresh. Its own module so component tests can mock it; a browser won't let a
// test replace window.location.
export function leaveTo(path: string): void {
  window.location.assign(path);
}
