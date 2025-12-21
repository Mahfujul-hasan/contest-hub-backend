const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vqc4z0k.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
// middleware 
app.use(express.json());
app.use(cors())


// jwt middleware 
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }

    req.decoded = decoded;
    next();
  });
};

app.get('/', (req, res) => {
  res.send('Hello World!')
})


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("contest-hub-db");
    const usersCollection = db.collection("users");
    const contestCollection = db.collection("contests");
    const paymentCollection = db.collection("payments");
    const participationCollection = db.collection("participations");
    const submissionCollection = db.collection("submissions");
    const winnersCollection = db.collection("winners");


    // Middleware for admin verify 
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;

      if (!email) {
        return res.status(401).send({ message: "Unauthorized" });
      }

      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden: Admin only" });
      }

      next();
    };

    // Middleware for creator
    const verifyCreator = async (req, res, next) => {
      const email = req.decoded?.email;
      const user = await usersCollection.findOne({ email });

      if (!user || (user.role !== 'creator' && user.role !== 'admin')) {
        return res.status(403).send({ message: 'Creator access only' });
      }
      next();
    };


    // Middleware for admin and creator both
    const verifyAdminOrCreator = async (req, res, next) => {
      const email = req.decoded?.email;

      if (!email) {
        return res.status(401).send({ message: "Unauthorized" });
      }

      const user = await usersCollection.findOne({ email });

      if (!user || !['admin', 'creator'].includes(user.role)) {
        return res.status(403).send({
          message: "Forbidden: Admin or Creator only"
        });
      }

      next();
    };

    //jwt related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;

      if (!user?.email) {
        return res.status(400).send({ message: "Email required" });
      }

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1d'
      });

      res.send({ accessToken: token });
    });



    // contest related API 
    app.post('/contests', verifyJWT, verifyCreator, async (req, res) => {
      const contestInfo = req.body;
      console.log(contestInfo);
      const result = await contestCollection.insertOne(contestInfo)
      res.send(result);
    })
    app.patch('/contests/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "invalid contest Id" })
      }
      const query = { _id: new ObjectId(id) };
      const updatedInfo = req.body;

      console.log(updatedInfo);
      const result = await contestCollection.updateOne(query, { $set: updatedInfo })
      res.send(result)

    })
    app.patch('/contests/:id/status', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "invalid contest Id" })
      }
      const query = { _id: new ObjectId(id) };
      const contestStatusInfo = req.body;
      const updateStatusInfo = {
        $set: {
          status: contestStatusInfo.status
        }
      }
      const updateContestStatus = await contestCollection.updateOne(query, updateStatusInfo)
      res.send(updateContestStatus)
    })

    app.delete('/contests/:id', verifyJWT, verifyAdminOrCreator, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "invalid contest Id" })
      }
      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/contests', async (req, res) => {

      const result = await contestCollection.find().sort({ createdAt: -1 }).toArray()
      res.send(result);
    })

    app.get('/contests/approved', async (req, res) => {
      const { limit, searchQuery } = req.query;
      const query = {
        status: "approved",

      }
      if (searchQuery) {
        query.contestType = { $regex: searchQuery, $options: "i" }
      }


      const result = await contestCollection.find(query).sort({ participantsCount: -1 }).limit(parseInt(limit)).toArray()
      res.send(result);
    })

    app.get('/contests/winner/:userId', verifyJWT, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).send({ message: "Invalid user ID" });
        }

        const query = { winnerId: userId }

        const result = await contestCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error", error: error.message });
      }
    });


    app.get('/contests/:search', verifyJWT, async (req, res) => {
      const search = req.params.search;
      const query = {}
      if (ObjectId.isValid(search) && search.length === 24) {
        query._id = new ObjectId(search)
      } else {
        query.creatorEmail = search;
      }

      const result = await contestCollection.find(query).toArray()
      res.send(result)
    })

    // participation related api

    app.get('/participations', verifyJWT, async (req, res) => {
      const contestId = req.query.contestId;
      const userId = req.query.userId;
      const query = {}
      if (contestId && userId) {
        query.userId = userId;
        query.contestId = contestId
      }
      const result = await participationCollection.findOne(query)
      res.send(result)
    })

    app.get('/participations/:search', verifyJWT, async (req, res) => {
      const search = req.params.search;
      const query = {}
      if (search) {
        query.userId = search
      } else {
        query.userEmail = search;
      }

      const result = await participationCollection.find(query).toArray()
      res.send(result)
    })


    // user related API 
    app.post('/users', async (req, res) => {
      const userInfo = req.body;
      userInfo.role = "user";
      userInfo.createdAt = new Date();
      userInfo.totalParticipations = 0;
      userInfo.totalWins = 0;
      const email = userInfo.email;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.status(409).send({ message: "Email already exists" })
      }

      const result = await usersCollection.insertOne(userInfo);
      res.send(result);

    })

    app.get('/users', verifyJWT, async (req, res) => {

      const result = await usersCollection.find().sort({ totalWins: -1 }).toArray()
      res.send(result)
    })
    app.get('/users/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query)
      res.send(user)
    })
    app.get('/users/:email/role', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    app.patch('/users/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const bioInfo = req.body;
      const query = {}
      if (email) {
        query.email = email
      }


      updatedInfo = {
        $set: {
          bio: bioInfo.bio,
          photoURL: bioInfo.photoURL,
          displayName: bioInfo.displayName
        }
      }
      console.log(updatedInfo);
      const result = await usersCollection.updateOne(query, updatedInfo)
      res.send(result);
    })
    app.patch('/users/:id/role', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "invalid user Id" })
      }
      const query = { _id: new ObjectId(id) };
      const userRoleInfo = req.body;
      console.log(userRoleInfo);
      const updatedRole = {
        $set: {
          role: userRoleInfo.role
        }
      }
      const updateUserRole = await usersCollection.updateOne(query, updatedRole)
      res.send(updateUserRole)
    })

    // submission related API
    app.post('/submissions', verifyJWT, async (req, res) => {
      const submissionInfo = req.body;
      const result = await submissionCollection.insertOne(submissionInfo)
      res.send(result)
    })

    app.get('/submissions', verifyJWT, verifyCreator, async (req, res) => {
      const { contestId } = req.query;
      const query = {}
      if (contestId) {
        query.contestId = contestId
      }
      const result = await submissionCollection.find(query).toArray()
      res.send(result)
    })

    app.get('/submissions/user-submission-status', async (req, res) => {
      const { userId, contestId } = req.query;
      if (!userId || !contestId) {
        return res.status(400).send({
          error: 'Both userId and contestId are required',
          hasSubmitted: false
        })
      }
      const query={
      userId: userId,
      contestId: contestId
    }
      const submission = await submissionCollection.findOne(query);
    res.send(submission._id)
    })

    app.patch('/submissions/:id', verifyJWT, verifyCreator, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "invalid submission Id" })
        }
        const query = { _id: new ObjectId(id) };

        const submission = await submissionCollection.findOne(query)

        if (!submission) {
          return res.status(404).send({ message: "Submission not found" });
        }
        if (submission.isWinner === "winner") {
          return res.status(400).send({ message: "This submission is already marked as winner" });
        }

        const updatedSubmissionInfo = {
          $set: {
            isWinner: "winner"
          }
        }
        const updateSubmission = await submissionCollection.updateOne(query, updatedSubmissionInfo)

        await usersCollection.updateOne({ _id: new ObjectId(submission.userId) }, { $inc: { totalWins: 1 } })

        await contestCollection.updateOne({ _id: new ObjectId(submission.contestId) },
          {
            $set: {
              winnerId: submission.userId,
              winnerName: submission.userName,
              winnerPhoto: submission.userPhoto
            }
          })
        const contest = await contestCollection.findOne({ _id: new ObjectId(submission.contestId) })
        if (!contest) {
          return res.status(404).send({ message: "Contest not found" });
        }
        const winnerInfo = {
          winnerId: submission.userId,
          winnerName: submission.userName,
          winnerPhoto: submission.userPhoto,
          contestName: submission.contestName,
          contestType: contest.contestType,
          prizeMoney: contest.prizeMoney,
          createdAt: new Date()
        }
        await winnersCollection.insertOne(winnerInfo)
        res.send({ success: true, message: "Winner declared successfully" });
      } catch (error) {
        res.status(500).send({ success: false, message: "Internal server error", error: error.message });

      }

    })


    // winner related api
    app.get('/winners', async (req, res) => {

      const result = await winnersCollection.find().sort({
        createdAt: -1
      }).limit(3).toArray()
      res.send(result);
    })





    // payment related api
    app.post('/create-checkout-session', verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.entryPrice) * 100
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'BDT',
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.contestName}`,
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          contestId: paymentInfo.contestId,
          contestName: paymentInfo.contestName,
          contestType: paymentInfo.contestType,
          contestImage: paymentInfo.contestImage,
          participantId: paymentInfo.participantId,
          participantName: paymentInfo.participantName,
          participantEmail: paymentInfo.participantEmail,
          participantPhoto: paymentInfo.participantPhoto,
          deadline: paymentInfo.deadline,
          entryPrice: paymentInfo.entryPrice,
          prizeMoney: paymentInfo.prizeMoney,
        },
        customer_email: paymentInfo.participantEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.send({ url: session.url })
    });

    app.patch('/payment-success', verifyJWT, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId }
        const existingPayment = await paymentCollection.findOne(query);

        if (existingPayment) {
          return res.send({ message: "Payment already processed", transactionId })
        }


        if (session.payment_status === "paid") {

          const paymentRecord = {
            userId: session.metadata.participantId,
            userName: session.metadata.participantName,
            userEmail: session.metadata.participantEmail,
            userImage: session.metadata.participantPhoto,
            contestId: session.metadata.contestId,
            contestName: session.metadata.contestName,
            contestType: session.metadata.contestType,
            amount: session.amount_total / 100,
            currency: session.currency.toUpperCase(),
            transactionId: transactionId,
            paymentStatus: session.payment_status,
            paidAt: new Date()
          }

          const paymentResult = await paymentCollection.insertOne(paymentRecord);

          const participationRecord = {
            userId: session.metadata.participantId,
            userName: session.metadata.participantName,
            userEmail: session.metadata.participantEmail,
            userImage: session.metadata.participantPhoto,
            contestId: session.metadata.contestId,
            contestName: session.metadata.contestName,
            contestType: session.metadata.contestType,
            contestImage: session.metadata.contestImage,
            entryPrice: parseInt(session.metadata.entryPrice),
            prizeMoney: parseInt(session.metadata.prizeMoney),
            deadline: session.metadata.deadline,
            paymentStatus: session.payment_status,
            transactionId: transactionId,
            participatedAt: new Date()
          };

          const participationResult = await participationCollection.insertOne(participationRecord)

          const contest = await contestCollection.findOne({ _id: new ObjectId(session.metadata.contestId) });

          let contestUpdateResult;
          if (contest.participantsCount === null || contest.participantsCount === undefined) {
            const queryContest = { _id: new ObjectId(session.metadata.contestId) }
            const updateContest = {
              $set: { participantsCount: 1 }
            }
            contestUpdateResult = await contestCollection.updateOne(queryContest, updateContest)
          } else {
            const queryContest = { _id: new ObjectId(session.metadata.contestId) }
            const updateContest = {
              $inc: { participantsCount: 1 }
            }
            contestUpdateResult = await contestCollection.updateOne(queryContest, updateContest)

          }


          const queryUser = { _id: new ObjectId(session.metadata.participantId) }
          const updateUser = {
            $inc: { totalParticipations: 1 }
          }
          const userUpdateResult = await usersCollection.updateOne(queryUser, updateUser);
          res.send({
            success: true,
            message: "Payment successful! You are now registered for the contest.",
            data: {
              transactionId: transactionId,
              contestId: session.metadata.contestId,
              paymentInserted: paymentResult.acknowledged,
              participationInserted: participationResult.acknowledged,
              contestUpdated: contestUpdateResult.modifiedCount > 0,
              userUpdated: userUpdateResult.matchedCount > 0


            }
          })
        } else {
          res.send({
            success: false,
            message: 'Payment was not completed',
            paymentStatus: session.payment_status
          });
        }
      } catch (error) {
        res.status(500).send({
          success: false,
          error: "Failed to process payment",
          details: error.message
        })

      }
    })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
