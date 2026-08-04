import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sample content for the `/community` feed.
 *
 * Every document written here carries `isDemoData: true` — the same flag the
 * demo users and hostels already use — and `--clean` deletes exactly and only
 * documents carrying it. Nothing in the app reads the flag, so seeded posts
 * behave like any other post until you remove them:
 *
 *   npm run seed:community          # write the sample posts
 *   npm run seed:community:clean    # remove every seeded post, comment, reaction
 *
 * Re-running the seed cleans first, so it is idempotent rather than additive.
 *
 * Posts are text-only on purpose. Media asset ids have to exist in R2 to render,
 * and a seeded id would point at nothing — a feed of broken thumbnails is worse
 * than a feed without pictures. Attach real media by posting from the UI.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to seed community posts.");
}

const shouldCleanOnly = process.argv.includes("--clean");

const looseSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const model = (name) => mongoose.models[name] ?? mongoose.model(name, looseSchema);

const User = model("User");
const Hostel = model("Hostel");
const CommunityPost = model("CommunityPost");
const CommunityComment = model("CommunityComment");
const CommunityReaction = model("CommunityReaction");
const CommunityCommentVote = model("CommunityCommentVote");
const Sponsor = model("Sponsor");

const DEMO = { isDemoData: true };

/** Minutes ago, so the feed shows a plausible spread of "3h" / "2d" stamps. */
function ago(minutes) {
  return new Date(Date.now() - minutes * 60_000);
}

async function clean() {
  const [posts, comments, reactions, votes, sponsors] = await Promise.all([
    CommunityPost.deleteMany(DEMO),
    CommunityComment.deleteMany(DEMO),
    CommunityReaction.deleteMany(DEMO),
    CommunityCommentVote.deleteMany(DEMO),
    Sponsor.deleteMany(DEMO),
  ]);

  return {
    sponsors: sponsors.deletedCount,
    votes: votes.deletedCount,
    comments: comments.deletedCount,
    posts: posts.deletedCount,
    reactions: reactions.deletedCount,
  };
}

/**
 * Reuse whatever accounts the demo seed already created. Falling back to any
 * account at all keeps the script useful on a database that was never demo
 * seeded; it never creates users of its own, because a stray login is a worse
 * thing to leave behind than a stray post.
 */
async function findAuthors() {
  const demoUsers = await User.find(DEMO).select("name role").limit(8).lean();
  const users =
    demoUsers.length > 0
      ? demoUsers
      : await User.find({}).select("name role").limit(8).lean();

  if (users.length === 0) {
    throw new Error(
      "No user accounts found. Run `npm run seed:demo` first — posts need an author.",
    );
  }

  return users;
}

async function findHostel() {
  const hostel =
    (await Hostel.findOne(DEMO).select("name").lean()) ??
    (await Hostel.findOne({}).select("name").lean());

  if (!hostel) {
    throw new Error("No hostel found. Run `npm run seed:demo` first.");
  }

  return hostel;
}

/**
 * A believable mix: questions from people still looking, answers from people
 * already living somewhere, one hostel-only post so the audience rule is
 * visible, and one staff announcement pinned above the rest.
 */
function postPlan({ hostel, users }) {
  const author = (index) => users[index % users.length]._id;

  return [
    {
      body: "Moving to Kathmandu next month for +2. Is Baneshwor or Kalanki better for getting to Trinity on time? Bus takes forever from what people tell me. #kathmandu",
      createdAt: ago(35),
      spaceType: "PUBLIC",
      authorId: author(1),
      reactionCount: 4,
    },
    {
      body: "PSA for anyone hostel hunting: ask what the water situation is in Chaitra–Jestha, not just today. Two places I toured had tankers coming twice a week and nobody mentions it until you have paid the deposit. #reviews #kathmandu",
      createdAt: ago(180),
      spaceType: "PUBLIC",
      authorId: author(2),
      reactionCount: 27,
    },
    {
      body: "Anyone else studying for the IOE entrance? Looking for 2-3 people to do a mock test every Saturday morning. I can book a study room. #roommate",
      createdAt: ago(420),
      spaceType: "PUBLIC",
      authorId: author(3),
      reactionCount: 9,
    },
    {
      body: "Honest question — is it normal for a hostel to keep your citizenship copy? Mine asked for the original at check-in and I said no. Was I being difficult? #reviews",
      createdAt: ago(1500),
      spaceType: "PUBLIC",
      authorId: author(4),
      reactionCount: 15,
    },
    {
      body: "Six months in and the thing I did not expect to matter most: which floor you are on. Ground floor is 5 degrees colder in winter and every single person walks past your door. #reviews",
      createdAt: ago(2900),
      spaceType: "PUBLIC",
      authorId: author(5),
      reactionCount: 41,
    },
    {
      body: "Futsal on Saturday 6am at the ground behind the college. Need four more people, we have the booking either way.",
      createdAt: ago(90),
      hostelId: hostel._id,
      spaceType: "HOSTEL",
      authorId: author(6),
      reactionCount: 12,
      visibility: "PUBLIC",
    },
    {
      body: "Whoever keeps taking the blue bucket from the second floor washroom — I am not angry, I just need it back on Sunday. Please.",
      createdAt: ago(600),
      hostelId: hostel._id,
      spaceType: "HOSTEL",
      authorId: author(7),
      reactionCount: 33,
      // The one post a signed-out reader must not be able to see.
      visibility: "HOSTEL_ONLY",
    },
    {
      body: "Water tank cleaning this Sunday 7am–11am. Supply will be off during that window — please fill what you need on Saturday night. Sorry for the short notice.",
      createdAt: ago(240),
      hostelId: hostel._id,
      isAnnouncement: true,
      spaceType: "HOSTEL",
      authorId: author(0),
      reactionCount: 6,
      visibility: "HOSTEL_ONLY",
    },
  ];
}

/**
 * `replyTo` names an earlier entry's `key`, so the seeded tree exercises the
 * threading the UI draws — a top-level comment, a reply, and a reply to that
 * reply — rather than a flat list that looks the same at every depth.
 */
function commentPlan({ users }) {
  const author = (index) => users[index % users.length]._id;

  return [
    {
      body: "Baneshwor, easily. Kalanki traffic in the morning will cost you an hour every single day.",
      createdAt: ago(20),
      key: "baneshwor",
      postIndex: 0,
      authorId: author(2),
      score: 5,
    },
    {
      body: "Good to know, thank you. Booking a visit for next week then.",
      createdAt: ago(14),
      key: "baneshwor-thanks",
      postIndex: 0,
      authorId: author(1),
      replyTo: "baneshwor",
      score: 2,
    },
    {
      body: "Take the Ring Road bypass if you do end up in Kalanki — 20 minutes flat outside rush hour.",
      createdAt: ago(9),
      key: "bypass",
      postIndex: 0,
      authorId: author(5),
      replyTo: "baneshwor-thanks",
      score: 3,
    },
    {
      body: "Depends where in Kalanki honestly, but yes, Baneshwor if you can afford it.",
      createdAt: ago(12),
      key: "kalanki",
      postIndex: 0,
      authorId: author(5),
      score: 1,
    },
    {
      body: "This is the single most useful thing anyone has posted here. Adding it to my list of questions.",
      createdAt: ago(150),
      key: "water-psa",
      postIndex: 1,
      authorId: author(3),
      score: 8,
    },
    {
      body: "You were not being difficult. A photocopy is normal, handing over the original is not.",
      createdAt: ago(1400),
      key: "citizenship",
      postIndex: 3,
      authorId: author(6),
      score: 12,
    },
    {
      body: "In. Put me down for Saturday.",
      createdAt: ago(60),
      key: "futsal",
      postIndex: 5,
      authorId: author(4),
      score: 1,
    },
  ];
}

/**
 * A believable rail: colleges buying the top slots, hostels below them, and a
 * local business at the bottom — in descending `priority`, which is the order
 * the rail renders them in.
 */
function sponsorPlan() {
  return [
    {
      accentColor: "#0a8a4b",
      ctaLabel: "Apply",
      highlight: "Admissions open",
      kind: "COLLEGE",
      linkUrl: "/hostels",
      name: "Trinity International College",
      priority: 40,
      subtitle: "Dillibazar · +2 & Bachelors",
    },
    {
      accentColor: "#1d4ed8",
      ctaLabel: "Book a visit",
      highlight: "Scholarships up to 50%",
      kind: "COLLEGE",
      linkUrl: "/hostels",
      name: "Kathmandu Model College",
      priority: 30,
      subtitle: "Bagbazar · Science & Management",
    },
    {
      accentColor: "#163a2a",
      ctaLabel: "View",
      highlight: "NPR 9,500/mo",
      kind: "HOSTEL",
      linkUrl: "/hostels",
      name: "Everest Comfort Hostel",
      priority: 20,
      subtitle: "Baneshwor · ⭐ 4.6",
    },
    {
      accentColor: "#b45309",
      ctaLabel: "Order",
      highlight: "20% off for students",
      kind: "BUSINESS",
      linkUrl: "/hostels",
      name: "Himalayan Java · Putalisadak",
      priority: 10,
      subtitle: "Study-friendly · Open till 9pm",
    },
  ];
}

async function seed() {
  const [users, hostel] = await Promise.all([findAuthors(), findHostel()]);
  const removed = await clean();

  const created = await CommunityPost.insertMany(
    postPlan({ hostel, users }).map((post) => ({
      commentCount: 0,
      isAnnouncement: false,
      media: [],
      reportCount: 0,
      status: "VISIBLE",
      visibility: "PUBLIC",
      ...post,
      ...DEMO,
    })),
  );

  // Inserted one at a time, in plan order, because a reply needs the real
  // `_id` of the comment above it — which only exists once that one is written.
  const idByKey = new Map();
  const comments = [];

  for (const { key, postIndex, replyTo, ...comment } of commentPlan({ users })) {
    const [created_] = await CommunityComment.insertMany([
      {
        ...comment,
        hostelId: created[postIndex].hostelId ?? null,
        parentId: replyTo ? (idByKey.get(replyTo) ?? null) : null,
        postId: created[postIndex]._id,
        status: "VISIBLE",
        ...DEMO,
      },
    ]);

    idByKey.set(key, created_._id);
    comments.push({ postId: created[postIndex]._id });
  }

  // Keep the denormalised counter honest — the feed renders it directly.
  for (const post of created) {
    const count = comments.filter(
      (comment) => comment.postId.toString() === post._id.toString(),
    ).length;

    if (count > 0) {
      await CommunityPost.updateOne({ _id: post._id }, { $set: { commentCount: count } });
    }
  }

  const sponsors = await Sponsor.insertMany(
    sponsorPlan().map((sponsor) => ({ ...sponsor, isActive: true, ...DEMO })),
  );

  return {
    comments: comments.length,
    hostel: hostel.name,
    posts: created.length,
    removed,
    sponsors: sponsors.length,
  };
}

await mongoose.connect(process.env.MONGODB_URI);

try {
  if (shouldCleanOnly) {
    const removed = await clean();

    console.log(
      `Removed ${removed.posts} seeded posts, ${removed.comments} comments, ${removed.reactions} reactions, ${removed.sponsors} sponsors.`,
    );
  } else {
    const result = await seed();

    console.log(
      `Seeded ${result.posts} posts, ${result.comments} comments and ${result.sponsors} sponsors (hostel space: ${result.hostel}).`,
    );
    console.log("Remove them at any time with: npm run seed:community:clean");
  }
} finally {
  await mongoose.disconnect();
}
