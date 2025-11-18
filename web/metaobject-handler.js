import shopify from "./shopify.js";

/**
 * Extracts the metaobject type from a metafield definition
 * For metaobject_reference types, the validation contains the referenced type
 */
export function extractMetaobjectType(metafieldDefinition) {
  if (!metafieldDefinition || metafieldDefinition.type?.name !== "metaobject_reference") {
    return null;
  }

  // The metaobject type is stored in validations
  const validations = metafieldDefinition.validations || [];
  const nameValidation = validations.find(v => v.name === "metaobject_definition_id");

  if (nameValidation && nameValidation.value) {
    return nameValidation.value;
  }

  return null;
}

/**
 * Fetches a metaobject definition by type
 */
export async function getMetaobjectDefinition(session, definitionId) {
  const client = new shopify.api.clients.Graphql({ session });

  const query = `
    query GetMetaobjectDefinition($id: ID!) {
      metaobjectDefinition(id: $id) {
        id
        name
        type
        fieldDefinitions {
          key
          name
          description
          required
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }
  `;

  try {
    const response = await client.request(query, {
      variables: { id: definitionId }
    });

    return response.data.metaobjectDefinition;
  } catch (error) {
    console.error("Error fetching metaobject definition:", error);
    throw error;
  }
}

/**
 * Recursively creates a metaobject with nested metaobject references
 * @param {Object} session - Shopify session
 * @param {String} metaobjectType - The type of metaobject to create
 * @param {Object} fieldValues - Object containing field keys and values
 * @param {Object} metaobjectDefinition - The metaobject definition with field info
 * @returns {String} - The GID of the created metaobject
 */
export async function createMetaobject(session, metaobjectType, fieldValues, metaobjectDefinition) {
  const client = new shopify.api.clients.Graphql({ session });

  // Process field values - handle nested metaobject references recursively
  const processedFields = [];

  for (const fieldDef of metaobjectDefinition.fieldDefinitions) {
    const fieldKey = fieldDef.key;
    const fieldValue = fieldValues[fieldKey];

    // Skip if no value provided and field is not required
    if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
      if (fieldDef.required) {
        throw new Error(`Required field ${fieldKey} is missing`);
      }
      continue;
    }

    // Check if this field is a metaobject_reference
    if (fieldDef.type.name === "metaobject_reference") {
      // Get the referenced metaobject type
      const referencedTypeValidation = fieldDef.validations?.find(v => v.name === "metaobject_definition_id");

      if (!referencedTypeValidation) {
        throw new Error(`Cannot find referenced metaobject type for field ${fieldKey}`);
      }

      const referencedDefinitionId = referencedTypeValidation.value;

      // Fetch the definition for the referenced metaobject
      const referencedDefinition = await getMetaobjectDefinition(session, referencedDefinitionId);

      // Recursively create the nested metaobject
      const nestedMetaobjectGid = await createMetaobject(
        session,
        referencedDefinition.type,
        fieldValue, // fieldValue should be an object with nested field values
        referencedDefinition
      );

      processedFields.push({
        key: fieldKey,
        value: nestedMetaobjectGid
      });
    } else if (fieldDef.type.name === "file_reference") {
      // File reference - value should already be a GID
      processedFields.push({
        key: fieldKey,
        value: String(fieldValue)
      });
    } else {
      // Simple field types - convert to string
      processedFields.push({
        key: fieldKey,
        value: String(fieldValue)
      });
    }
  }

  const mutation = `
    mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
          fields {
            key
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

  try {
    const response = await client.request(mutation, {
      variables: {
        metaobject: {
          type: metaobjectType,
          fields: processedFields
        }
      }
    });

    if (response.data.metaobjectCreate.userErrors.length > 0) {
      throw new Error(
        `Failed to create metaobject: ${JSON.stringify(response.data.metaobjectCreate.userErrors)}`
      );
    }

    return response.data.metaobjectCreate.metaobject.id;
  } catch (error) {
    console.error("Error creating metaobject:", error);
    throw error;
  }
}

/**
 * Updates an existing metaobject
 */
export async function updateMetaobject(session, metaobjectId, fieldValues, metaobjectDefinition) {
  const client = new shopify.api.clients.Graphql({ session });

  // Process field values - handle nested metaobject references recursively
  const processedFields = [];

  for (const fieldDef of metaobjectDefinition.fieldDefinitions) {
    const fieldKey = fieldDef.key;
    const fieldValue = fieldValues[fieldKey];

    // Skip if no value provided
    if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
      continue;
    }

    // Check if this field is a metaobject_reference
    if (fieldDef.type.name === "metaobject_reference") {
      // For updates, if the value is already a GID, use it
      // Otherwise, create a new nested metaobject
      if (typeof fieldValue === 'string' && fieldValue.startsWith('gid://')) {
        processedFields.push({
          key: fieldKey,
          value: fieldValue
        });
      } else if (typeof fieldValue === 'object') {
        const referencedTypeValidation = fieldDef.validations?.find(v => v.name === "metaobject_definition_id");
        const referencedDefinitionId = referencedTypeValidation?.value;

        if (!referencedDefinitionId) {
          throw new Error(`Cannot find referenced metaobject type for field ${fieldKey}`);
        }

        const referencedDefinition = await getMetaobjectDefinition(session, referencedDefinitionId);

        const nestedMetaobjectGid = await createMetaobject(
          session,
          referencedDefinition.type,
          fieldValue,
          referencedDefinition
        );

        processedFields.push({
          key: fieldKey,
          value: nestedMetaobjectGid
        });
      }
    } else {
      processedFields.push({
        key: fieldKey,
        value: String(fieldValue)
      });
    }
  }

  const mutation = `
    mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
          fields {
            key
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

  try {
    const response = await client.request(mutation, {
      variables: {
        id: metaobjectId,
        metaobject: {
          fields: processedFields
        }
      }
    });

    if (response.data.metaobjectUpdate.userErrors.length > 0) {
      throw new Error(
        `Failed to update metaobject: ${JSON.stringify(response.data.metaobjectUpdate.userErrors)}`
      );
    }

    return response.data.metaobjectUpdate.metaobject.id;
  } catch (error) {
    console.error("Error updating metaobject:", error);
    throw error;
  }
}

/**
 * Fetches an existing metaobject by ID
 */
export async function getMetaobject(session, metaobjectId) {
  const client = new shopify.api.clients.Graphql({ session });

  const query = `
    query GetMetaobject($id: ID!) {
      metaobject(id: $id) {
        id
        handle
        type
        fields {
          key
          value
          type
          reference {
            ... on Metaobject {
              id
              type
              fields {
                key
                value
                type
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await client.request(query, {
      variables: { id: metaobjectId }
    });

    return response.data.metaobject;
  } catch (error) {
    console.error("Error fetching metaobject:", error);
    throw error;
  }
}
