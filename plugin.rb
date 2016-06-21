# name: discourse-osf-integration
# about: An integration plug-in for the Open Science Framework
# version: 0.0.1
# authors: Center for Open Science
enabled_site_setting :osf_integration_enabled

require 'pry'

after_initialize do
    module ::OsfIntegration
        PROJECT_GUID_FIELD_NAME = "project_guid"
        TOPIC_GUID_FIELD_NAME = "topic_guid"

        class Engine < ::Rails::Engine
            engine_name "osf_integration"
            isolate_namespace OsfIntegration
        end
    end

    # Register these custom fields so that they will allowed as parameters
    # We don't pass a block however, because we don't want to allow these guids
    # to be changed in the future.
    PostRevisor.track_topic_field(:project_guid)
    PostRevisor.track_topic_field(:topic_guid)

    # Hook onto topic creation to save our custom fields
    on(:topic_created) do |topic, params, user|
      return unless user.try(:staff?)

      topic.custom_fields.update(::OsfIntegration::PROJECT_GUID_FIELD_NAME => params[:project_guid])
      topic.custom_fields.update(::OsfIntegration::TOPIC_GUID_FIELD_NAME => params[:topic_guid])
      topic.save
    end

    # Add methods to class for directly extracting these fields
    add_to_class :topic, :project_guid do
      custom_fields[::OsfIntegration::PROJECT_GUID_FIELD_NAME]
    end
    add_to_class :topic, :topic_guid do
      custom_fields[::OsfIntegration::TOPIC_GUID_FIELD_NAME]
    end

    # override slug generation
    add_to_class :topic, :slug do
      topic_guid
    end

    # Register these custom fields to be able to appear in serializer output
    TopicViewSerializer.attributes_from_topic(:project_guid)
    TopicViewSerializer.attributes_from_topic(:topic_guid)

    # Return osf related stuff in JSON output of topic items
    add_to_serializer(:topic_list_item, :project_guid) { object.project_guid }
    add_to_serializer(:topic_list_item, :topic_guid) { object.topic_guid }

    # Mark as preloaded so that they are always available
    if TopicList.respond_to? :preloaded_custom_fields
        TopicList.preloaded_custom_fields << ::OsfIntegration::PROJECT_GUID_FIELD_NAME
        TopicList.preloaded_custom_fields << ::OsfIntegration::TOPIC_GUID_FIELD_NAME
    end
end
