const { join } = require("path");
const puppeteer = require("puppeteer");
const himalaya = require("himalaya");
const fs = require("fs");
const path = require("path");
const download = require("progress-download");
const sanitize = require("sanitize-filename");

const USERNAME = "your username here, this is probably your accounts email";
const PASSWORD = "your password here";

const courseData = [];
const BIN_REGEX = new RegExp(
  "(http(s?)://embed-ssl.wistia.com/deliveries/)(.{1,40})(.bin)"
);

// put all the courses you want to download in this array
const COURSE_URLS = [
  "https://cgcookie.com/course/modeling-weapons-for-a-first-person-shooter",
  "https://cgcookie.com/course/creating-sci-fi-weapon-concepts",
];
const DOWNLOAD_DIRECTORY = path.join(__dirname, "videos");
const HTML_SELECTORS = {
  EMAIL_INPUT: "input#user_email",
  PASSWORD_INPUT: "input#user_password",
  LOGIN_BUTTON: "input[name='commit']",
  COURSE_TITLE:
    "#content > section > div.hero-inner.text-left.container > div > h1",
};

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}
function removeEmptyNodes(nodes) {
  return nodes.filter((node) => {
    if (node.type === "element") {
      node.children = removeEmptyNodes(node.children);
      return true;
    }
    return node.content.length;
  });
}

function stripWhitespace(nodes) {
  return nodes.map((node) => {
    if (node.type === "element") {
      node.children = stripWhitespace(node.children);
    } else {
      node.content = node.content.trim();
    }
    return node;
  });
}

function removeWhitespace(nodes) {
  return removeEmptyNodes(stripWhitespace(nodes));
}

(async () => {
  // if (!fs.existsSync(join(__dirname, "Videos"))) {
  //   fs.mkdirSync(join(__dirname, "Videos"));
  // }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://cgcookie.com/login", {
    waitUntil: "networkidle2",
  });
  await page.type(HTML_SELECTORS.EMAIL_INPUT, USERNAME);
  await page.type(HTML_SELECTORS.PASSWORD_INPUT, PASSWORD);
  await page.click(HTML_SELECTORS.LOGIN_BUTTON);
  await page.waitForNavigation({ waitUntil: "domcontentloaded" });

  for (var a = 0; a < COURSE_URLS.length; a++) {
    await page.goto(COURSE_URLS[a], { waitUntil: "networkidle2" });
    const chapterArray = await page.evaluate(
      () =>
        document.querySelector(
          "#content > div.container.container-course > div > div.col-md-4 > div > ul"
        ).innerHTML
    );
    let json = himalaya.parse(chapterArray);
    json = removeWhitespace(json);
    await parseJsonData(page, json);

    await delay(4000);
  }

  await browser.close();
})();

async function parseJsonData(page, data) {
  const courseTitle = await page.evaluate(
    () =>
      document.querySelector(
        "#content > section > div.hero-inner.text-left.container > div > h1"
      ).textContent
  );
  for (var i = 0; i < data.length; i++) {
    courseData[i] = [];
    let d = data[i];
    let ChapterName = d["children"][0].children[0].content;
    const courseTitleClean = sanitize(courseTitle);
    const chapterNameClean = sanitize(`Chapter ${i + 1}. ${ChapterName}`);
    const chapterFolderPath = path.join(
      DOWNLOAD_DIRECTORY,
      courseTitleClean,
      chapterNameClean
    );
    if (!fs.existsSync(chapterFolderPath)) {
      fs.mkdirSync(chapterFolderPath, { recursive: true });
    }
    let chapterVideosChild = d["children"][3].children;
    for (var j = 0; j < chapterVideosChild.length; j++) {
      courseData[i][j] = {};
      for (
        var k = 0;
        k < chapterVideosChild[j]["children"][0].attributes.length;
        k++
      ) {
        const attribute = chapterVideosChild[j]["children"][0].attributes[k];
        if (attribute.key == "href") {
          courseData[i][j]["url"] =
            "https://cgcookie.com" +
            chapterVideosChild[j]["children"][0].attributes[k].value;
        }
      }
      const children = chapterVideosChild[j]["children"][0].children[0];
      if (children.attributes[0].value == "content-title") {
        const numberPrefix = Object.keys(courseData[i]).length;
        const videoTitle = children.children[0].content;
        const videoTitleSafe = sanitize(videoTitle);
        courseData[i][j].savepath = chapterFolderPath;
        courseData[i][j].safetitle = `${numberPrefix}. ${videoTitleSafe}.mp4`;
      }
    }
  }

  for await (const chapterVideos of courseData) {
    for await (const video of chapterVideos) {
      if (fs.existsSync(join(video.savepath, video.safetitle))) {
        console.debug(`${video.safetitle} Video Exists, skipping...`);
        continue;
      }
      const videoURL = video.url;
      console.debug(`Video URL: `, videoURL);
      await page.goto(videoURL, {
        waitUntil: "networkidle2",
      });

      const wistiaID = await page.evaluate(() => {
        const video = document.querySelector(".video");
        if (!video) return null;
        const videos = video.children;
        console.log(`Videos: `, videos);
        const videosArray = Array.from(videos);
        console.log(`Videos array: `, videosArray);
        return videosArray.find((x) => x.id.startsWith("wistia_")).id;
      });
      if (wistiaID === null) continue;

      console.debug(`wistia ID: ${wistiaID}`);
      const wistiaJSONUrl = `https://fast.wistia.com/embed/medias/${
        wistiaID.split("_")[1]
      }.json`;

      await page.goto(wistiaJSONUrl, {
        waitUntil: "networkidle2",
        referer: "https://cgcookie.com/",
      });
      const html = await page.evaluate(() => {
        return document.querySelector("body").innerHTML;
      });
      let binURL = html.match(BIN_REGEX)[0];
      console.log(`Downloading video ${video.safetitle}...`);
      await downloadVideo(binURL, video.savepath, video.safetitle);
    }
  }
}
function downloadVideo(url, directory, filename) {
  return new Promise((resolve, reject) => {
    download(url, directory, { filename })
      .then(() => resolve())
      .catch((e) => reject(e));
  });
}
