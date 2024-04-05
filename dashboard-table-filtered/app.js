const dynamoose = require('dynamoose');

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

const filteredTableData = async (date) => {
  let obj = {};
  if (!date) {
    return obj;
  } else {
    try {
      const result = await property
        .query('created_at')
        .eq(date)
        .using('created_at-SK-index')
        .exec();

      const reduced = result.reduce((filtered, rows) => {
        if (rows.SK.includes('TASK#')) {
          rows.ner = rows.latency ? rows.latency.ner : undefined;
          rows.qna = rows.latency ? rows.latency.qna : undefined;
          rows.PK = rows.PK.split('#')[1];
          rows.SK = rows.SK.split('#')[1];
          let job = {
            user: rows.PK,
            jobId: rows.SK,
          };
          const base64data = Buffer.from(JSON.stringify(job)).toString(
            'base64'
          );
          rows.encodeId = base64data;

          if (
            rows.job_status &&
            rows.job_status.ner === 'COMPLETED' &&
            rows.job_status.qna === 'COMPLETED' &&
            rows.job_status.textract === 'COMPLETED' &&
            rows.job_status.textract_analyze === 'COMPLETED'
          ) {
            rows.current_status = 'COMPLETED';
          } else if (
            (rows.job_status && rows.job_status.ner === 'FAILED') ||
            rows.job_status.qna === 'FAILED' ||
            rows.job_status.textract === 'FAILED' ||
            rows.job_status.textract_analyze === 'FAILED'
          ) {
            rows.current_status = 'FAILED';
          } else {
            rows.current_status = 'PENDING';
          }

          filtered.push(rows);
        }
        return filtered;
      }, []);

      obj.result = reduced;
      return {
        statusCode: 200,
        body: JSON.stringify(obj),
      };
    } catch (err) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Data Filter Error',
        }),
      };
    }
  }
};

export const lambdaHandler = async (event) => {
  let date = event?.queryStringParameters?.date || null;
  try {
    const data = await filteredTableData(date);
    console.log('Filtered Data Output:- ', data);
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
