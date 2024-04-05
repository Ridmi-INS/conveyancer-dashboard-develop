const dynamoose = require('dynamoose');
const axios = require('axios');

const ddb = new dynamoose.aws.ddb.DynamoDB({
  region: 'us-east-1',
});

dynamoose.aws.ddb.set(ddb);

const propertySchema = new dynamoose.Schema(
  {
    PK: {
      type: String,
    },
    SK: {
      type: String,
    },
    created_at: {
      type: String,
      index: {
        global: true,
        name: 'created_at-SK-index',
      },
    },
    file_name: {
      type: String,
    },
    latency: {
      type: Object,
    },
    job_status: {
      type: Object,
    },
  },
  {
    saveUnknown: ['latency.**', 'job_status.**'],
  }
);

const property = dynamoose.model('section32insighture', propertySchema, {
  create: false,
});

const getModalData = async () => {
  let output = {};

  try {
    // const modalData = await axios.get(`${process.env.MODALAPI}`);
    // const output = modalData.data.modelItems.reduce((filtered , rows) =>{
    //   if(rows.sourceGitRepo !== 'kekayan/auto-conveyancer-haystack-qna'){
    //     rows.sourceGitRepo = rows.sourceGitRepo.split('/')[1];

    //     delete rows.key;
    //     filtered.push(rows);
    //   }

    //   return filtered;
    // }, [])

    const [{ data: bill }, { data: ner }, { data: qna }] = await Promise.all([
      await axios.get(`${process.env.BILLINGAPI}`),
      await axios.get(`${process.env.NERAPI}`),
      await axios.get(`${process.env.QNAAPI}`),
    ]);

    output = {
      bill: {
        billUpcoming: bill.billUpcoming,
        billPaid: bill.billPaid,
      },
      mlModals: [
        {
          sourceGitRepo: ner.sourceGitRepo.split('/')[1],
          workingTasks: ner.workingTasks,
          queuedTasks: ner.queuedTasks,
          callsFinished: ner.callsFinished,
        },
        {
          sourceGitRepo: `${qna.sourceGitRepo.split('/')[1]}-qna`,
          workingTasks: qna.workingTasks,
          queuedTasks: qna.queuedTasks,
          callsFinished: qna.callsFinished,
        },
      ],
    };

    return output;
  } catch (err) {
    console.log('Error in Modal Data:- ', err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Modal retrieval Error',
      }),
    };
  }
};

const queryDynamoData = async () => {
  let obj = {};
  let todaysSucCount = 0;
  let todaysCount = 0;
  let todaysErrorCount = 0;
  let date = new Date().toJSON().slice(0, 10);

  try {
    const [modalData, propertyData] = await Promise.all([
      getModalData(),
      property.query('created_at').eq(date).using('created_at-SK-index').exec(),
    ]);

    const reduced = propertyData.reduce((filtered, rows) => {
      if (rows.SK.includes('TASK#')) {
        todaysCount += 1;

        rows.ner = rows.latency ? rows.latency.ner : undefined;
        rows.qna = rows.latency ? rows.latency.qna : undefined;
        rows.PK = rows.PK.split('#')[1];
        rows.SK = rows.SK.split('#')[1];
        let job = {
          user: rows.PK,
          jobId: rows.SK,
        };
        const base64data = Buffer.from(JSON.stringify(job)).toString('base64');
        rows.encodeId = base64data;
        if (
          rows.job_status &&
          rows.job_status.ner === 'COMPLETED' &&
          rows.job_status.qna === 'COMPLETED' &&
          rows.job_status.textract === 'COMPLETED' &&
          rows.job_status.textract_analyze === 'COMPLETED'
        ) {
          rows.current_status = 'COMPLETED';
          todaysSucCount += 1;
        } else if (
          (rows.job_status && rows.job_status.ner === 'FAILED') ||
          rows.job_status.qna === 'FAILED' ||
          rows.job_status.textract === 'FAILED' ||
          rows.job_status.textract_analyze === 'FAILED'
        ) {
          rows.current_status = 'FAILED';
          todaysErrorCount += 1;
        } else {
          rows.current_status = 'PENDING';
        }
        filtered.push(rows);
      }
      return filtered;
    }, []);

    obj.result = reduced;
    obj.counts = {
      filteredRow: todaysCount,
      filteredSuccessRow: todaysSucCount,
      filteredFailedRow: todaysErrorCount,
      totalRows: propertyData.scannedCount,
    };
    obj.modal = modalData;

    return {
      statusCode: 200,
      body: JSON.stringify(obj),
    };
  } catch (err) {
    console.log('retrivel error:- ', err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Data retrieval Error',
      }),
    };
  }
};

export const lambdaHandler = async (event) => {
  try {
    const data = await queryDynamoData();
    console.log('Data Output:- ', data);
    return data;
  } catch (err) {
    console.log(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'some error happened',
      }),
    };
  }
};
