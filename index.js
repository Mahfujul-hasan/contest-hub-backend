const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require("firebase-admin");

const serviceAccount = require("./contest-hub-frontend-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


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

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" })
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next()
  } catch (error) {
    res.status(401).send({ message: "Unauthorized access" })
  }

}
app.get('/', (req, res) => {
  res.send('Hello World!')
})


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contest-hub-db");
    const usersCollection = db.collection("users");
    const contestCollection = db.collection("contests");
    const paymentCollection = db.collection("payments");
    const participationCollection = db.collection("participations");

    // contest related API 
    app.post('/contests', async (req, res) => {
      const contestInfo = req.body;
      console.log(contestInfo);
      const result = await contestCollection.insertOne(contestInfo)
      res.send(result);
    })
    app.patch('/contests/:id', async (req, res) => {
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

    app.delete('/contests/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "invalid contest Id" })
      }
      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/contests', async (req, res) => {
      const result = await contestCollection.find().toArray()
      res.send(result);
    })


    app.get('/contests/:search', async (req, res) => {
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


    // user related API 
    app.post('/users', async (req, res) => {
      const userInfo = req.body;
      userInfo.role = "user";
      userInfo.createdAt = new Date()
      const email = userInfo.email;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.status(409).send({ message: "Email already exists" })
      }

      const result = await usersCollection.insertOne(userInfo);
      res.send(result);

    })

    app.get('/users', async (req, res) => {

      const result = await usersCollection.find().toArray()
      res.send(result)
    })
    app.get('/users/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query)
      res.send(user)
    })
    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    app.patch('/users/:email', async (req, res) => {
      const email = req.params.email;
      const bioInfo = req.body.bio;
      const query = {}
      if (email) {
        query.email = email
      }


      updatedInfo = {
        $set: {
          bio: bioInfo
        }
      }
      console.log(updatedInfo);
      const result = await usersCollection.updateOne(query, updatedInfo)
      res.send(result);
    })


    // payment related api
    app.post('/create-checkout-session', async (req, res) => {
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
          participantId: paymentInfo.participantId,
          participantName: paymentInfo.participantName,
          participantEmail: paymentInfo.participantEmail,
          participantPhoto: paymentInfo.participantPhoto,
          deadline: paymentInfo.deadline,
          entryPrice: paymentInfo.entryPrice
        },
        customer_email: paymentInfo.participantEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.send({ url: session.url })
    });

    app.patch('/payment-success', async (req, res) => {
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
          currency: session.currency,
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
          entryPrice: parseInt(session.metadata.entryPrice),
          deadline: session.metadata.deadline,
          paymentStatus: session.payment_status,
          transactionId: transactionId,
          participatedAt: new Date()
        };

        const participationResult= await participationCollection.insertOne(participationRecord)

        const queryContest={_id:new ObjectId(session.metadata.contestId)}
        const updateContest = {
          $inc:{participantsCount:1}
        }
        const contestUpdateResult=await contestCollection.updateOne(queryContest,updateContest)

        const queryUser={_id:new ObjectId(session.metadata.participantId)}
        const updateUser={
          $inc:{totalParticipation:1}
        }
        const userUpdateResult =await usersCollection.updateOne(queryUser,updateUser);
        res.send({
          success:true,
          message:"Payment successful! You are now registered for the contest.",
          data:{
            transactionId:transactionId,
            contestId:session.metadata.contestId,
            paymentInserted:paymentResult.acknowledged,
            participationInserted:participationResult.acknowledged,
            contestUpdated:contestUpdateResult.modifiedCount>0,
            userUpdated:userUpdateResult.matchedCount>0


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
          success:false,
          error:"Failed to process payment",
          details:error.message
      })
      
    }
  })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
