import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"./e2e", testMatch:process.env.OBSERVER_PAGES_TEST ? "observer-pages.spec.ts" : process.env.CLOUD_PAGES_TEST ? "cloud-pages.spec.ts" : "pages.spec.ts", timeout:45000,
  use:{baseURL:"http://127.0.0.1:4187/sg-real-time-flights/",viewport:{width:1440,height:900},
    launchOptions:{args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]}},
  webServer:{command:"npm run preview -- --port 4187 --outDir dist-pages --base /sg-real-time-flights/",
    url:"http://127.0.0.1:4187/sg-real-time-flights/",reuseExistingServer:false},
});
