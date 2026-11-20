import {test,expect} from "@playwright/test";
test("Pages loads Cesium and explicit demo under the repository path without a backend",async({page})=>{
  const sockets:string[]=[];
  const broken:string[]=[];
  page.on("websocket",socket=>sockets.push(socket.url()));
  page.on("response",r=>{if(r.status()>=400 && r.url().startsWith("http://127.0.0.1:4187"))broken.push(r.url());});
  await page.goto("./");
  await expect(page.getByRole("button",{name:/Select SYN/})).toHaveCount(16);
  await expect(page.getByRole("button",{name:"Live",exact:true})).toBeDisabled();
  await expect(page.getByText("Synthetic scenario · no real flights")).toBeVisible();
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({timeout:20000});
  await page.getByRole("button",{name:"3D",exact:true}).click();
  await expect(page.getByRole("button",{name:"2D",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Select SYN 101"}).click();
  await expect(page.getByRole("region",{name:"Selected aircraft details"})).toBeVisible();
  expect(await page.getByRole("link",{name:"Changi Observatory home"}).getAttribute("href")).toBe("/sg-real-time-flights/");
  expect(sockets).toEqual([]);
  expect(broken).toEqual([]);
});
