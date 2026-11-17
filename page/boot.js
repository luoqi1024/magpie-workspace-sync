// magpie shows this file as the plugin's page. The real page is served by the
// plugin's own service (see src/server.js), so this only sends the frame there:
// to magpie.service when magpie says where the service is (a browser on another
// computer, through `magpie web`), else to the port on this computer.
;(async () => {
  const m = document.getElementById("m")
  try {
    await magpie.ready
    let opts = {}
    try {
      opts = (await magpie.options.get()) || {}
    } catch {
      // no options set
    }
    const port = Number(opts.port) > 0 ? Number(opts.port) : 3481
    location.replace(magpie.service || `http://127.0.0.1:${port}/`)
  } catch (e) {
    m.textContent = "Couldn't open Workspace Sync: " + (e && e.message ? e.message : e)
  }
})()
