import shopify from "./shopify.js";
import FormData from "form-data";
import axios from "axios";

function getShopifyResourceType(mimeType) {
  if (mimeType.startsWith('image/')) {
    return 'IMAGE';
  } else if (mimeType.startsWith('video/')) {
    return 'VIDEO';
  } else {
    return 'FILE';
  }
}

export async function uploadFileToShopify(session, fileBuffer, filename, mimeType) {
  const client = new shopify.api.clients.Graphql({ session });

  try {
    // Step 1: Create staged upload
    const stagedUploadMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const stagedUploadResponse = await client.request(stagedUploadMutation, {
      variables: {
        input: [{
          filename: filename,
          mimeType: mimeType,
          resource: getShopifyResourceType(mimeType),
          fileSize: fileBuffer.length.toString(),
          httpMethod: "POST",
        }],
      },
    });

    if (stagedUploadResponse.data.stagedUploadsCreate.userErrors.length > 0) {
      throw new Error(
        `Staged upload errors: ${JSON.stringify(stagedUploadResponse.data.stagedUploadsCreate.userErrors)}`
      );
    }

    const stagedTarget = stagedUploadResponse.data.stagedUploadsCreate.stagedTargets[0];

    // Step 2: Upload file to staged URL (Build multipart form data - parameters MUST come before the file)
    const formData = new FormData();

    stagedTarget.parameters.forEach((param) => {
      formData.append(param.name, param.value);
    });

    formData.append('file', fileBuffer, {
      filename: filename,
      contentType: mimeType,
    });

    const uploadResponse = await axios.post(stagedTarget.url, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      // maxContentLength: Infinity,
      // maxBodyLength: Infinity,
    });

    // Step 3: Create file in Shopify
    const fileCreateMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            ... on GenericFile {
              id
              url
              mimeType
              originalFileSize
            }
            ... on MediaImage {
              id
              image {
                url
              }
              mimeType
              originalSource {
                fileSize
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const fileCreateResponse = await client.request(fileCreateMutation, {
      variables: {
        files: [{
          originalSource: stagedTarget.resourceUrl,
          contentType: getShopifyResourceType(mimeType),
        }],
      },
    });

    if (fileCreateResponse.data.fileCreate.userErrors.length > 0) {
      throw new Error(
        `File create errors: ${JSON.stringify(fileCreateResponse.data.fileCreate.userErrors)}`
      );
    }

    const file = fileCreateResponse.data.fileCreate.files[0];

    let fileUrl = null;
    if (file.url) {
      fileUrl = file.url;
    } else if (file.image && file.image.url) {
      fileUrl = file.image.url;
    } else if (stagedTarget.resourceUrl) {
      fileUrl = stagedTarget.resourceUrl;
    }

    return {
      shopifyFileId: file.id,
      filename: filename,
      fileType: mimeType,
      fileUrl: fileUrl,
      fileSize: file.originalFileSize || file.originalSource?.fileSize,
    };
  } catch (error) {
    console.error("Error uploading file to Shopify:", error);
    throw error;
  }
}