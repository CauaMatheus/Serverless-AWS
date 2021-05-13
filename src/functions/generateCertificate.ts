import { document } from '../utils/dynamoDBClient';
import path from 'path';
import fs from 'fs';
import chromium from 'chrome-aws-lambda';
import handlebars from 'handlebars';
import { formatToStringDate } from 'src/utils/formatToStringDate';
import { S3 } from 'aws-sdk';
import { APIGatewayProxyHandler } from 'aws-lambda';

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async (data:ITemplate) => {
  const filePath = path.join(process.cwd(), 'src', 'templates', 'certificate.hbs');
  
  const html = fs.readFileSync(filePath, 'utf-8');

  return handlebars.compile(html)(data)
}

export const handle: APIGatewayProxyHandler = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  const response = await document.query({
    TableName: 'users_certificates',
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':id': id
    }
  }).promise()

  const userAlreadyExists = response.Items[0]

  if(!userAlreadyExists) {
    await document.put({
      TableName: 'users_certificates',
      Item: {
        id,
        name, 
        grade,
      },
    }).promise();
  }

  // Gerar medalha para HTML
  const medalPath = path.join(process.cwd(), 'src', 'templates', 'selo.png');
  const medal = fs.readFileSync(medalPath, 'base64');

  // Compilar HTML com o handlebars
  const data = {
    id,
    name,
    grade,
    date: formatToStringDate(new Date()),
    medal,
  }
  const content = await compile(data)

  // Transformar o HTML compilado em PDF
  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
  })
  const page = await browser.newPage();
  await page.setContent(content)

  const pdf = await page.pdf({
    format: 'a4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    path: process.env.IS_OFFLINE ? 'certificate.pdf' : null
  });

  await browser.close()


  // Salver no S3
  const s3 = new S3();
  await s3.putObject({
    Bucket: 'certificate-ignite',
    Key: `${id}.pdf`,
    ACL: 'public-read',
    Body: pdf,
    ContentType: 'application/pdf'
  }).promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: 'Certificate created!',
      url: `https://certificate-ignite.s3-sa-east-1.amazonaws.com/${id}.pdf`
    }),
    headers: {
      "Content-Type": "application/json",
    }
  }
}